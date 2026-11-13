We are building Roombook, a command-line tool that a small coworking space uses to manage its meeting rooms and their bookings. It will grow one feature request at a time; each request arrives separately, in a later session.

Conventions for every command, now and in every later request:
- It runs as `python -m roombook <command> ...` from the repository root, with Python 3.14 and the standard library only. pytest is installed for tests.
- All data lives in the directory named by the environment variable `ROOMBOOK_DATA` (create it when it is missing). Write nothing anywhere else.
- On success: exit code 0, and exactly one JSON value printed on stdout.
- Invalid input, or a name or id that does not exist: exit code 1. A conflict with an existing booking: exit code 2. When a request is both invalid and in conflict, it is invalid (exit 1). On an error, print a message on stderr; stdout may stay empty.
- Times are local, without time zone, in the format `YYYY-MM-DDTHH:MM`. Dates are `YYYY-MM-DD`. Anything else is invalid input.
- Options may appear in any order.
- Lists are JSON arrays. Objects may carry more fields than a request names.
