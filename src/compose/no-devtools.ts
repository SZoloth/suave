/** react-lang mounts its inspector widget in development unless this flag is already set when it loads. */
(globalThis as Record<symbol, unknown>)[Symbol.for("openui.devtools.autoMount")] = true;
