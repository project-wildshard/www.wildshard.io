# Cap push-gate test workers

Stamp repo-kit 40c5f46 so the local gate gives Node and Vitest a
quarter of the available cores. Set `WS_GATE_WORKERS` to override
the ceiling. Test commands keep lower worker limits.
