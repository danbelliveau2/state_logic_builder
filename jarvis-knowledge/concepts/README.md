# CONCEPTS, NOT RULES

> **When Jarvis gets something wrong, deepen the understanding here; do not
> append a rule. — Dan, Aug 2026**

"How we use servo motors there is how we use servo motors in lots of places…
You have to understand the concepts, not the specific rules, because there are
too many unique scenarios. Understand the concepts and apply them to the
unique scenarios."

Every `.md` file in this directory (except this README) is loaded into the
Jarvis compile and translation prompts. Each file is written the way a senior
SDC controls engineer would explain the subject to a new hire: the mechanism,
the intent behind it, and the judgment calls — with template rungs used as
illustrations of the concept, never as the law itself. What varies per
application is called out explicitly.

Keep files small (they all ride in every prompt) and keep them about
understanding. Bare facts that are genuinely just facts (a mnemonic spelling,
a character limit) belong in `src/lib/agentGenerator/generationRules.md`.
