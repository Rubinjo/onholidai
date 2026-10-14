# Coordinated rollout

Run fresh/001–010-upgrade compatibility with 011/012 in isolation. Deploy reviewed web and booking worker revisions together; do not enable linked bookings with an account-ID-assuming older worker. Validate account!=principal book/status/recover/cancel/reschedule and original execution evidence.

To disable guest entry, withdraw public bootstrap/setup entry at the deployment edge while preserving ownership and account booking guards. Do not delete principals, sessions, accepted history, link receipts or run identities; do not destructively roll back 011/012. Recover with a reviewed forward deployment.

No rollout/migration/recovery was executed; T068/T082 remain open.
