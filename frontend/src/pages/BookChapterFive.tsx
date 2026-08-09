import { useEffect, useMemo, useState } from "react";
import "./book-chapter.css";

type Exercise = {
  id: string;
  title: string;
  scenario: string;
  task: string;
  hint?: string;
  solution?: string;
};

type Section = {
  id: string;
  title: string;
  body: string[];
  code?: string;
  exercises?: Exercise[];
};

const chapterTitle = "Chapter 5: Testing That Proves Something";

const sections: Section[] = [
  {
    id: "what-this-chapter-is-about",
    title: "What This Chapter Is About",
    body: [
      "By the end of Chapter 4, Load Planning Engine has real service behavior and real configuration. That also means it now has more ways to break.",
      "This chapter is about building a test suite that catches the kinds of mistakes the service is now capable of making. You will write tests for the planner, the API contract, error paths, configuration behavior, and the seams between layers. The goal is not to chase a coverage number. The goal is to make the test suite fail when the service is wrong.",
      "That sounds obvious, but a lot of test suites do not do it. They exercise easy code paths, mock too much, and pass happily while real regressions slide through.",
    ],
  },
  {
    id: "why-this-matters",
    title: "Why This Matters",
    body: [
      "Tests are easy to overvalue once they exist.",
      "A project adds `pytest`, writes a handful of passing tests, and starts to feel safe. Then a real bug shows up. A validation rule changed. A path assumption broke in CI. A refactor changed the planner output shape. Nothing in the test suite complained because the tests were checking the wrong thing or checking it through too much mocking.",
      "That is the difference this chapter is trying to make clear. A test is useful when it protects a property of the system that you would actually care about losing. It is not useful just because it executes code.",
    ],
    code: `planning_engine/\n├── src/\n│   └── planning_engine/\n│       ├── api/\n│       ├── config.py\n│       ├── models.py\n│       └── planner.py\n└── tests/`,
  },
  {
    id: "start-with-the-core-planning-logic",
    title: "Start with the Core Planning Logic",
    body: [
      "The planner is the smallest useful place to start. It has direct behavior, a clear contract, and fewer moving parts than the full application layer.",
      "If the tests cannot protect the planning contract here, they are unlikely to protect the larger service later.",
    ],
    exercises: [
      {
        id: "exercise-5-1",
        title: "Exercise 5.1: Write the First Unit Test for the Planner",
        scenario:
          "The planner has no direct tests. The only way to check its behavior is through manual API calls.",
        task:
          "Write a unit test that calls the planner directly and validates the basic planning contract.",
        solution:
          "Start by testing the planner directly. A unit test at that level should validate the planning contract without needing the web layer.",
      },
      {
        id: "exercise-5-2",
        title: "Exercise 5.2: Add Edge Case Coverage for Input Values",
        scenario:
          "The planner works for normal input, but nobody has tested empty values, negative values, or extremely large values.",
        task:
          "Add parameterized tests for the main edge cases the planner should reject or handle.",
        solution:
          "Parameterized tests keep the contract visible by showing which inputs are expected to fail, which should pass, and what behavior should stay stable.",
      },
      {
        id: "exercise-5-3",
        title: "Exercise 5.3: Catch an Out-of-Range Score Regression",
        scenario:
          "A refactor accidentally allows the planner to return `1.2` for one input path.",
        task:
          "Write the regression test that exposes the bug, then describe what property the test protects.",
        solution:
          "The regression test should state the property clearly: the planner must not return values outside the allowed range.",
      },
    ],
  },
  {
    id: "test-the-api-contract-properly",
    title: "Test the API Contract Properly",
    body: [
      "Once the service boundary moves to HTTP, the request and response shape become part of the contract. Those shapes deserve direct tests, not just indirect confidence from unit tests.",
      "The aim here is to test behavior at the API layer without mocking away the contract itself.",
    ],
    exercises: [
      {
        id: "exercise-5-4",
        title: "Exercise 5.4: Add a Test for POST /planning-requests",
        scenario:
          "The request-submission endpoint works manually, but no automated test checks the full request and accepted-response shape.",
        task:
          "Add an API test for `POST /planning-requests` using the test client.",
        solution:
          "An API test for `POST /planning-requests` should validate the request and accepted-response shape, not just the existence of a 202 response.",
      },
      {
        id: "exercise-5-5",
        title: "Exercise 5.5: Test Invalid Input Behavior",
        scenario:
          "The endpoint now uses request validation, but there is no test proving bad input returns the correct error response.",
        task:
          "Write a test that sends invalid input and checks the response status and body shape.",
        solution:
          "Bad input should produce the right validation error path. If the service returns 200 for invalid input, the tests should catch it.",
      },
      {
        id: "exercise-5-6",
        title: "Exercise 5.6: Test the Status Endpoint Without Duplicating Logic",
        scenario:
          "`GET /planning-requests/{request_id}` was added, but there is no test covering pending, completed, and missing request states.",
        task:
          "Write a test that validates the status response shape and the reuse of the underlying request lookup path.",
        solution:
          "The status test should prove that the endpoint reuses the request lookup path instead of becoming a second independent implementation.",
      },
      {
        id: "exercise-5-7",
        title: "Exercise 5.7: Test the Safe Config Endpoint",
        scenario:
          "`GET /config` returns non-sensitive configuration, but nobody has verified that secret values stay excluded.",
        task:
          "Write a test that proves safe settings are present and secrets are absent.",
        solution:
          "The safe config endpoint should be tested for exclusion as much as inclusion. The bug you care about is often the secret value that should not be there.",
      },
    ],
  },
  {
    id: "use-fixtures-instead-of-repetition",
    title: "Use Fixtures Instead of Repetition",
    body: [
      "Tests become harder to maintain when each file invents its own setup. Shared fixtures are useful when they remove repeated construction and keep the setup shape consistent across the suite.",
      "The point is not just fewer lines. The point is fewer ways for tests to drift apart for no good reason.",
    ],
    exercises: [
      {
        id: "exercise-5-8",
        title: "Exercise 5.8: Extract a Shared Test Client Fixture",
        scenario:
          "Multiple test files create their own application instance and test client in slightly different ways.",
        task:
          "Move the common setup into a reusable fixture.",
        solution:
          "Shared setup belongs in fixtures when multiple tests need the same application or client construction. The value is consistency.",
      },
      {
        id: "exercise-5-9",
        title: "Exercise 5.9: Add a Fake Request Service Fixture",
        scenario:
          "API tests keep rebuilding test doubles inline, and each one returns slightly different shapes.",
        task:
          "Create a reusable fake request service fixture that keeps API tests consistent.",
        solution:
          "A fake request service fixture gives the API tests one stable dependency shape and makes failures easier to compare.",
      },
      {
        id: "exercise-5-10",
        title: "Exercise 5.10: Fix Fixture Scope That Leaks State",
        scenario:
          "A fixture is scoped too broadly, and one test changes shared state that affects another test later in the run.",
        task:
          "Fix the fixture scope and explain why the original scope was unsafe.",
        solution:
          "Fixture scope should be narrow enough that tests do not leak state into each other. If one test can change what another sees, the suite is harder to trust.",
      },
    ],
  },
  {
    id: "stop-mocking-the-wrong-things",
    title: "Stop Mocking the Wrong Things",
    body: [
      "Mocks are useful when they cut off a dependency you do not want to bring into the test. They are harmful when they replace the behavior you actually needed to validate.",
      "This section is about keeping mocks narrow enough that the test still proves something real.",
    ],
    exercises: [
      {
        id: "exercise-5-11",
        title: "Exercise 5.11: Replace a Global Patch with a Dependency Override",
        scenario:
          "An API test patches a module-level request service directly.",
        task:
          "Refactor the test to use FastAPI dependency overrides instead.",
        solution:
          "FastAPI dependency overrides are a better seam than patching a module-level global because they match how the application already receives its dependencies.",
      },
      {
        id: "exercise-5-12",
        title: "Exercise 5.12: Remove an Unnecessary Mock",
        scenario:
          "A unit test mocks a simple pure function inside the planner, which makes the test pass even when the real logic is broken.",
        task:
          "Remove the unnecessary mock and make the test validate real behavior.",
        solution:
          "If the function is pure and cheap, do not mock it just to make the test feel isolated. That usually removes the behavior you needed to verify.",
      },
      {
        id: "exercise-5-13",
        title: "Exercise 5.13: Keep the Queue Mock Narrow",
        scenario:
          "A test mocks the entire queue layer even though it only needs to simulate one missing queue configuration.",
        task:
          "Replace the broad mock with a narrower one that still exposes the startup failure path.",
        solution:
          "Mock only the queue-related call you need to fail. Broad mocks make tests easier to write and harder to trust.",
      },
    ],
  },
  {
    id: "catch-real-failures",
    title: "Catch Real Failures",
    body: [
      "A useful suite should protect against failures the team has either already seen or could reasonably expect to see. That usually means paths involving configuration, files, startup, and environment assumptions.",
      "These tests are often less glamorous than happy-path endpoint tests, but they tend to catch the bugs that waste the most time.",
    ],
    exercises: [
      {
        id: "exercise-5-14",
        title: "Exercise 5.14: Reproduce a CI-Only Path Bug",
        scenario:
          "The test suite passes locally but fails in CI with a `FileNotFoundError` caused by a bad relative path assumption.",
        task:
          "Write the test that exposes the path assumption and fix the underlying bug.",
        solution:
          "CI-only path bugs usually come from hidden assumptions about the working directory. The test should expose that assumption directly.",
      },
      {
        id: "exercise-5-15",
        title: "Exercise 5.15: Add a Test for Missing Startup Configuration",
        scenario:
          "If required configuration is missing, the service fails at startup, but no test proves that the error is clear.",
        task:
          "Write a test that verifies the failure message when required config is absent.",
        solution:
          "A startup failure test should check the clarity of the error, not just the existence of one. Operators need usable failure messages.",
      },
      {
        id: "exercise-5-16",
        title: "Exercise 5.16: Add a Test for Missing Queue Configuration",
        scenario:
          "If queue configuration is missing, startup should fail early, but this path is still untested.",
        task:
          "Write a test that proves the service refuses to start with a missing queue configuration.",
        solution:
          "Missing queue configuration should fail early and clearly. The test should prove both parts.",
      },
      {
        id: "exercise-5-17",
        title: "Exercise 5.17: Add an Integration Test for the Full Request Cycle",
        scenario:
          "The suite has unit tests and API tests, but nothing checks the full request cycle end to end through the application layer.",
        task:
          "Add an integration-style test that starts the application and validates a real planning request from submission to status lookup.",
        solution:
          "An integration test should validate a real planning request through the application layer, not rebuild the whole service in mocks and call that end to end.",
      },
    ],
  },
  {
    id: "make-the-suite-useful-in-daily-work",
    title: "Make the Suite Useful in Daily Work",
    body: [
      "Coverage reporting is useful when it points you toward untested behavior. It becomes useless when the percentage itself becomes the target.",
      "This last part of the chapter is about keeping testing metrics in the right place: useful, but secondary to whether the suite protects the properties you care about.",
    ],
    exercises: [
      {
        id: "exercise-5-18",
        title: "Exercise 5.18: Add Coverage Reporting Without Worshipping the Number",
        scenario:
          "The team wants coverage reporting, but one engineer keeps treating the percentage itself as the goal.",
        task:
          "Add coverage reporting and write one short note explaining what coverage can and cannot tell you.",
        solution:
          "Coverage reporting is useful for finding untested areas. It is not a guarantee that the important behavior is protected.",
      },
    ],
  },
  {
    id: "what-comes-next",
    title: "What Comes Next",
    body: [
      "In Chapter 6, you add automated quality gates so formatting, linting, and type checking stop being review-time arguments and start being enforced by tooling.",
    ],
  },
];

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export default function BookChapterFivePage() {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? "");

  const tocItems = useMemo(
    () =>
      sections.map((section) => ({
        id: section.id,
        title: section.title,
      })),
    [],
  );

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visible?.target?.id) {
          setActiveId(visible.target.id);
        }
      },
      {
        rootMargin: "-20% 0px -55% 0px",
        threshold: [0.1, 0.3, 0.6],
      },
    );

    const nodes = document.querySelectorAll<HTMLElement>("[data-book-section]");
    nodes.forEach((node) => observer.observe(node));

    return () => observer.disconnect();
  }, []);

  const scrollToSection = (id: string) => {
    const node = document.getElementById(id);
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="book-page">
      <div className="book-shell">
        <aside className="book-sidebar">
          <div className="book-sidebar-inner">
            <p className="book-sidebar-chapter">{chapterTitle}</p>
            <nav aria-label="Chapter table of contents" className="book-toc">
              {tocItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`book-toc-link ${activeId === item.id ? "is-active" : ""}`}
                  onClick={() => scrollToSection(item.id)}
                >
                  <span className="book-toc-indicator" aria-hidden="true" />
                  <span>{item.title}</span>
                </button>
              ))}
            </nav>
          </div>
        </aside>

        <main className="book-main">
          <article className="book-article">
            <header className="book-header">
              <p className="book-kicker">Load Planning Engine</p>
              <h1>{chapterTitle}</h1>
            </header>

            {sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                data-book-section
                className="book-section"
              >
                <h2>{section.title}</h2>

                {section.body.map((paragraph) => (
                  <p key={slugify(paragraph.slice(0, 48))}>
                    {renderInlineCode(paragraph)}
                  </p>
                ))}

                {section.code ? (
                  <pre className="book-code-block">
                    <code>{section.code}</code>
                  </pre>
                ) : null}

                {section.exercises?.length ? (
                  <div className="book-exercise-list">
                    {section.exercises.map((exercise) => (
                      <section key={exercise.id} id={exercise.id} className="book-exercise">
                        <h3>{exercise.title}</h3>
                        <div className="book-exercise-block">
                          <span className="book-label">Scenario</span>
                          <p>{renderInlineCode(exercise.scenario)}</p>
                        </div>
                        <div className="book-exercise-block">
                          <span className="book-label">Task</span>
                          <p>{renderInlineCode(exercise.task)}</p>
                        </div>
                        {exercise.hint ? (
                          <details className="book-disclosure">
                            <summary>Hint</summary>
                            <p>{renderInlineCode(exercise.hint)}</p>
                          </details>
                        ) : null}
                        {exercise.solution ? (
                          <details className="book-disclosure book-solution">
                            <summary>Reveal solution</summary>
                            <p>{renderInlineCode(exercise.solution)}</p>
                          </details>
                        ) : null}
                      </section>
                    ))}
                  </div>
                ) : null}
              </section>
            ))}
          </article>
        </main>
      </div>
    </div>
  );
}

function renderInlineCode(text: string) {
  const parts = text.split(/(`[^`]+`)/g);

  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}
