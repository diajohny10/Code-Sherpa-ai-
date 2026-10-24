# Browser CPython runtime assets

Run `npm run prepare:python` after installing dependencies. Large generated files are intentionally ignored by Git. The script downloads the pinned CPython 3.14.9 WASI archive, verifies its SHA-256 before extraction, and preserves `LICENSE`. `npm run check:python`, tests, and the prebuild hook validate the generated files against their manifest. Vite must copy this directory into the deployed build.

See `PYTHON_EXECUTION.md` for provenance, isolation limits, and deployment instructions. These are Brett Cannon's CPython WASI builds, not official PSF-hosted binary distributions. Keep the bundled CPython license and applicable notices when redistributing. The runtime has no server/database/OpenAI credentials and executes only in bounded browser workers.