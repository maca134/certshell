## Important Development Notes

- **All changes must be tested** - if you're not testing your changes, you're not done.
- **Get your tests to pass**. If you didn't run the tests, your code does not work.
- **Follow existing code style** - check neighboring files for patterns
- **Create tests in the right folder** in `test/` and the test must end in `.test.[ext]`
- **Use absolute paths** - Always use absolute paths in file operations
- **Avoid shell commands** - Don't use `find` or `grep` in tests; use Bun's Glob and built-in tools
- **Be humble & honest** - NEVER overstate what you got done or what actually works in commits, PRs or in messages to the user.
- **If you need a paragraph-long comment to justify why the workaround is OK, the code is wrong — fix the code.**.
- After every code comment you write, ask yourself, "Is this information the next Claude would spend multiple tool calls trying to understand?". If the answer isn't clearly yes, the code comment is noise - delete it.
- If my request is ambiguous, ask clarifying questions before doing anything.
- Preplan your tool calls, and group in batches where it makes sense.
- When reporting information to me, be extremely concise and sacrifice grammar for sake of concision.
- Don't change anything I didn't ask you to change.
