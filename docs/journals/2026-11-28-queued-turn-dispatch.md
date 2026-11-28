# Queued turn dispatch safety

The queue used only app-run and background-task state. A busy external Claude CLI
therefore appeared idle to the dispatcher even though the UI offered Queue. A startup
refusal also removed a claimed message unless its text matched one exact error string.

The dispatcher now checks the running-session service before claiming and before
starting a queued turn. Every startup refusal restores the message with a visible
failure reason. Per-session work guards replace the global scan lock, allowing other
idle sessions to dispatch while a long turn remains active. Schedules still interrupt
active runs when due and serialize within each session.

Regression fixtures cover CLI-only activity, startup refusal/exception, a reservation
race, a CLI becoming busy between checks, restoring alongside a newer follow-up, and
another session becoming ready during a long queued turn. These are local fake-runtime
tests. Actual external CLI acceptance is a separate Host verification.
