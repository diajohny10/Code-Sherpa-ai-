import unittest
from unittest.mock import patch

from backend.ai_provider import (
    DemoLearningProvider,
    InvalidProviderResponse,
    LearningProviderError,
    LearningPlan,
    MentorReply,
    OpenAILearningProvider,
    ProgressiveHints,
    create_provider,
    create_hints_safely,
    create_mentor_safely,
    create_plan_safely,
    select_provider,
    validate_learning_input,
)


class ProviderTests(unittest.TestCase):
    def test_missing_key_selects_demo_without_network_or_key(self):
        provider = create_provider({})
        self.assertIsInstance(provider, DemoLearningProvider)
        self.assertEqual(provider.mode, "deterministic-demo")
        self.assertIsInstance(select_provider(True, {}), DemoLearningProvider)
        self.assertIsInstance(select_provider(False, {"OPENAI_API_KEY": "test-only"}), DemoLearningProvider)
        self.assertEqual(select_provider(True, {"OPENAI_API_KEY": "test-only"}).mode, "openai")

    def test_demo_plan_includes_prime_edge_case_suggestions(self):
        plan = create_provider({}).create_plan("Write a prime checker")
        self.assertEqual(plan.title, "Prime number checker")
        self.assertIn("-1", [case.input for case in plan.test_cases])
        self.assertIn("-7", [case.input for case in plan.test_cases])
        self.assertEqual(plan.test_cases[0].category, "boundary")

    def test_demo_hints_are_ordered_for_progressive_reveal(self):
        hints = create_provider({}).create_hints("prime checker", [])
        self.assertGreaterEqual(len(hints.hints), 3)

    def test_even_odd_prompt_gets_domain_requirements_cases_and_hints(self):
        plan = create_provider({}).create_plan(
            "Check whether an integer is even or odd, including zero and negative values")
        self.assertEqual(plan.title, "Even and odd checker")
        self.assertTrue(any("negative" in item for item in plan.requirements))
        self.assertEqual({case.expected for case in plan.test_cases}, {"even", "odd"})
        self.assertIn("-4", [case.input for case in plan.test_cases])
        self.assertIn("0", [case.input for case in plan.test_cases])
        self.assertGreaterEqual(len(plan.hints), 3)

    def test_armstrong_prompt_gets_concrete_demo_cases_and_hints(self):
        plan = create_provider({}).create_plan("Check whether an integer is an Armstrong number")
        self.assertEqual(plan.title, "Armstrong number checker")
        self.assertEqual(
            [(case.input, case.expected) for case in plan.test_cases],
            [("is_armstrong(0)", "True"), ("is_armstrong(5)", "True"),
             ("is_armstrong(153)", "True"), ("is_armstrong(9474)", "True"),
             ("is_armstrong(123)", "False"), ("is_armstrong(-153)", "False")],
        )
        self.assertGreaterEqual(len(plan.hints), 3)

    def test_validates_plan_and_hint_contracts(self):
        plan = LearningPlan.from_untrusted({
            "title": "Task", "requirements": ["A", "B"],
            "test_cases": [{"input": "0", "expected": "False", "category": "boundary"},
                           {"input": "1", "expected": "False", "category": "ordinary"}],
            "hints": ["First hint"],
        })
        self.assertEqual(plan.as_dict()["title"], "Task")
        self.assertEqual(ProgressiveHints.from_untrusted({"hints": ["one"]}).hints, ["one"])
        with self.assertRaises(InvalidProviderResponse):
            LearningPlan.from_untrusted({"title": "Task", "requirements": [], "test_cases": [], "hints": []})
        malformed_category = {"title": "Task", "requirements": ["A", "B"],
            "test_cases": [{"input": "0", "expected": "False", "category": []},
                           {"input": "1", "expected": "False", "category": "ordinary"}],
            "hints": ["First"]}
        with self.assertRaises(InvalidProviderResponse):
            LearningPlan.from_untrusted(malformed_category)

    def test_openai_adapter_parses_mocked_data_without_api_call(self):
        provider = OpenAILearningProvider("fake-key-for-test")
        raw = {"title": "Mock task", "requirements": ["A", "B"],
               "test_cases": [{"input": "0", "expected": "False", "category": "boundary"},
                              {"input": "2", "expected": "True", "category": "ordinary"}],
               "hints": ["First", "Second"]}
        with patch.object(provider, "_request", return_value=raw) as mocked:
            result = provider.create_plan("task")
        self.assertEqual(result.title, "Mock task")
        mocked.assert_called_once()

    def test_malformed_mocked_ai_result_is_rejected(self):
        provider = OpenAILearningProvider("fake-key-for-test")
        with patch.object(provider, "_request", return_value={"title": "untrusted"}):
            with self.assertRaises(InvalidProviderResponse):
                provider.create_plan("task")

    def test_invalid_request_inputs_are_rejected_before_provider(self):
        with self.assertRaises(ValueError):
            validate_learning_input("  ")
        with self.assertRaises(ValueError):
            validate_learning_input("task", [""])

    def test_provider_errors_are_sanitized(self):
        class BrokenProvider:
            mode = "test"

            def create_plan(self, prompt):
                raise RuntimeError("private upstream detail")

            def create_hints(self, prompt, requirements):
                raise RuntimeError("private upstream detail")

        provider = BrokenProvider()
        with self.assertRaisesRegex(LearningProviderError, "request failed") as error:
            create_plan_safely(provider, "valid task")
        self.assertNotIn("private upstream detail", str(error.exception))
        with self.assertRaises(LearningProviderError):
            create_hints_safely(provider, "valid task", [])
        with self.assertRaises(LearningProviderError):
            create_mentor_safely(provider, {"prompt": "p", "requirements": [], "test_results": [],
                "challenge": "", "learner_text": ""}, "question")

    def test_demo_mentor_is_contextual_progressive_and_never_claims_execution(self):
        provider = create_provider({})
        context = {"prompt": "prime checker", "requirements": ["Return False for factors"],
                   "test_results": ["9 expected False"], "challenge": "", "learner_text": "factor found"}
        reply = create_mentor_safely(provider, context, "Why use modulo?")
        self.assertIn("zero remainder", reply.message)
        self.assertIn("return", reply.guiding_question.lower())
        self.assertGreaterEqual(len(reply.hints), 3)
        parity = create_mentor_safely(provider, {**context, "prompt": "even or odd"}, "How classify -3?")
        self.assertIn("remainder", parity.message)

    def test_mentor_context_and_response_are_validated(self):
        provider = create_provider({})
        context = {"prompt": "prime", "requirements": [], "test_results": [],
                   "challenge": "", "learner_text": ""}
        with self.assertRaises(ValueError):
            create_mentor_safely(provider, context, " ")
        with self.assertRaises(ValueError):
            create_mentor_safely(provider, {**context, "learner_text": "x" * 2_001}, "Question?")

        class MalformedMentor:
            mode = "test"
            def create_mentor(self, context, question):
                return MentorReply("", "", [])

        with self.assertRaises(InvalidProviderResponse):
            create_mentor_safely(MalformedMentor(), context, "Question?")


if __name__ == "__main__":
    unittest.main()
