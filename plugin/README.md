# anima-fovenda · DSH plugin

This directory is the DeepSeek Harness bundle: `index.js` (host) + `client.js` (Web client) + locale/icon.

For installation, data-root setup, security notes, and the runtime layout, read the package root [`README.md`](../README.md).

- Package: `anima-fovenda`
- API: `/anima-fovenda/api`
- License: MIT

The plugin reads the data root from `ANIMA_DATA` or `ANIMA_PATHS`; it does not guess a home directory. It does not create scheduled tasks, automatic backups, or a watch/inject flow.
