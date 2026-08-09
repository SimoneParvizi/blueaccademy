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

const chapterTitle = "Chapter 6: Linting, Formatting, and Code Quality";

const sections: Section[] = [
  {
    id: "what-this-chapter-is-about",
    title: "What This Chapter Is About",
    body: [
      "By the end of Chapter 5, Load Planning Engine has a service, configuration, and a test suite. That is enough for real work to start landing quickly. It is also the point where inconsistency starts to compound if the codebase has no automated quality gates.",
      "This chapter is about setting those gates. You will add linting, formatting, type checking, and pre-commit hooks so style issues, unused code, and type mistakes stop showing up for the first time in review or in CI after a long test run.",
      "The point is not to make the codebase look polished for its own sake. The point is to automate the repeated checks that humans are bad at doing consistently.",
    ],
  },
  {
    id: "why-this-matters",
    title: "Why This Matters",
    body: [
      "Teams often wait too long to add code quality tooling.",
      "The first few modules look manageable, so formatting gets left to individual preference. Imports drift. Unused variables pile up. Type hints are partial. Reviewers keep leaving the same comments because there is no faster way to enforce them. Then the project grows and those small inconsistencies become normal.",
      "That is when linting starts to feel painful, but the pain is mostly deferred cleanup. The tooling is not the real problem. The real problem is letting the codebase grow without a clear standard.",
    ],
    code: `planning_engine/\n├── pyproject.toml\n├── src/\n│   └── planning_engine/\n├── tests/\n└── README.md`,
  },
  {
    id: "add-ruff-and-make-it-do-real-work",
    title: "Add Ruff and Make It Do Real Work",
    body: [
      "A formatter and a linter should remove low-value manual review work. That only happens if the tools are actually configured and used, not just mentioned in the README.",
      "This section is about making Ruff do real work instead of sitting unused as a future plan.",
    ],
    exercises: [
      {
        id: "exercise-6-1",
        title: "Exercise 6.1: Run Ruff on a Messy Module",
        scenario:
          "A provided module has unused imports, inconsistent quoting, trailing whitespace, and dead local variables.",
        task:
          "Run `ruff check` on the module, fix the reported issues, then run `ruff format` and compare what each command changed.",
        solution:
          "Run `ruff check` first and fix the reported issues. Then run `ruff format`. The formatter changes layout, while the linter also surfaces problems such as unused imports and dead variables.",
      },
      {
        id: "exercise-6-2",
        title: "Exercise 6.2: Separate Formatting from Linting",
        scenario:
          "A teammate says the formatter already handles everything and the linter is redundant.",
        task:
          "Write a short note explaining what `ruff format` handles and what `ruff check` catches that formatting alone does not.",
        solution:
          "Formatting decides how the code is laid out. Linting checks for patterns that are unclear, risky, or simply wrong.",
      },
      {
        id: "exercise-6-3",
        title: "Exercise 6.3: Configure Ruff in pyproject.toml",
        scenario:
          "The project runs `ruff` with defaults only, and the team wants the configuration in version control.",
        task:
          "Add a `[tool.ruff]` configuration section to `pyproject.toml` with the project’s intended defaults.",
        solution:
          "Put the Ruff configuration in `pyproject.toml` so the rules travel with the project and local runs, CI, and teammate expectations line up.",
      },
      {
        id: "exercise-6-4",
        title: "Exercise 6.4: Fix Real Lint Findings Instead of Ignoring Them",
        scenario:
          "Running `ruff check` surfaces several issues, including an unused import and a shadowed variable that hides a real value.",
        task:
          "Fix the findings in code instead of suppressing them.",
        solution:
          "Fix real lint findings in code first. Suppression should be the exception, not the default response to a warning.",
      },
    ],
  },
  {
    id: "add-type-checking-that-actually-helps",
    title: "Add Type Checking That Actually Helps",
    body: [
      "Type checking is most useful where the code crosses boundaries between modules, layers, and data shapes. That is where it exposes wrong assumptions early.",
      "If the type checker becomes all noise, people stop trusting it. The goal here is to keep it strict enough to matter and focused enough to stay useful.",
    ],
    exercises: [
      {
        id: "exercise-6-5",
        title: "Exercise 6.5: Run Mypy on the Service Layer",
        scenario:
          "`mypy` has never been run against `src/planning_engine/`, and the team assumes the existing type hints are enough.",
        task:
          "Run mypy and identify the first set of errors that matter most.",
        solution:
          "Run mypy on `src/planning_engine/` and sort the results by impact. The first errors worth fixing are usually the ones at real service boundaries.",
      },
      {
        id: "exercise-6-6",
        title: "Exercise 6.6: Configure Mypy in pyproject.toml",
        scenario:
          "The project has no mypy configuration, so the checks are too loose to catch many useful problems.",
        task:
          "Add a `[tool.mypy]` section with sensible defaults for this codebase.",
        solution:
          "Add a mypy configuration that is strict enough to catch useful mistakes without producing noise the team will ignore.",
      },
      {
        id: "exercise-6-7",
        title: "Exercise 6.7: Fix Missing Return and Optional Type Errors",
        scenario:
          "`mypy` reports a function that can fall off the end without returning and another function that passes `None` into code that expects a real value.",
        task:
          "Fix both issues without using `# type: ignore`.",
        solution:
          "A missing return path and an unchecked `None` value are both runtime problems wearing static-analysis clothing. Fix them directly instead of silencing them.",
      },
      {
        id: "exercise-6-8",
        title: "Exercise 6.8: Add Type Hints Where They Clarify a Boundary",
        scenario:
          "A new helper function has no annotations, and its caller is already passing the wrong shape of data.",
        task:
          "Add type hints to the helper and fix the caller based on the error the annotations expose.",
        solution:
          "Type hints are most useful where data crosses a boundary between layers or modules. That is where they reveal wrong assumptions fastest.",
      },
    ],
  },
  {
    id: "use-suppressions-carefully",
    title: "Use Suppressions Carefully",
    body: [
      "Suppressions are sometimes necessary. They are also one of the easiest ways to teach a tool to stop showing you a real bug.",
      "This section is about keeping exceptions narrow and explained instead of using them as a blanket way to make the output quiet.",
    ],
    exercises: [
      {
        id: "exercise-6-9",
        title: "Exercise 6.9: Remove Unnecessary type: ignore",
        scenario:
          "A colleague added `# type: ignore` to several lines to quiet mypy before a deadline.",
        task:
          "Identify which suppressions are hiding real problems and remove them.",
        solution:
          "Remove suppressions that are only hiding code the type checker is correctly warning about. A quiet type checker is not the goal. A trustworthy one is.",
      },
      {
        id: "exercise-6-10",
        title: "Exercise 6.10: Keep One Suppression and Explain It",
        scenario:
          "One third-party library interaction still needs a suppression after the rest are cleaned up.",
        task:
          "Keep only the justified suppression and add a short explanation for why it is safe.",
        solution:
          "If one suppression remains, explain it. The explanation matters because someone else will eventually ask whether it is still needed.",
      },
      {
        id: "exercise-6-11",
        title: "Exercise 6.11: Add a Typed Wrapper Around a Weakly Typed Dependency",
        scenario:
          "A third-party helper returns `Any`, and that uncertainty spreads through several parts of the service.",
        task:
          "Wrap the third-party call in a typed function so the rest of the codebase gets a cleaner interface.",
        solution:
          "Typed wrappers are a good way to contain weakly typed third-party code and stop `Any` from spreading through the rest of the project.",
      },
    ],
  },
  {
    id: "add-pre-commit-hooks",
    title: "Add Pre-Commit Hooks",
    body: [
      "The most useful local hooks are the ones that catch issues developers are likely to forget but that are still fast enough to run before every commit.",
      "If the hook setup is too vague or too heavy, people stop trusting it or stop running it. The right setup is small, clear, and enforceable.",
    ],
    exercises: [
      {
        id: "exercise-6-12",
        title: "Exercise 6.12: Create .pre-commit-config.yaml",
        scenario:
          "The team keeps forgetting to run formatting and linting before committing changes.",
        task:
          "Add a basic `.pre-commit-config.yaml` that runs the main local quality checks.",
        solution:
          "Use pre-commit to run the checks developers are most likely to forget but that are still fast enough to run before every commit.",
      },
      {
        id: "exercise-6-13",
        title: "Exercise 6.13: Add the Ruff Hook Correctly",
        scenario:
          "The pre-commit config exists, but it only runs one tool and does not check the Python source the way the team expects.",
        task:
          "Add Ruff to the pre-commit config with the right hooks.",
        solution:
          "The Ruff hook should be configured explicitly so the project gets both the lint and format behavior it expects.",
      },
      {
        id: "exercise-6-14",
        title: "Exercise 6.14: Make the Hook Block a Bad Commit",
        scenario:
          "A commit with linting errors still passes locally because the hook was installed incorrectly.",
        task:
          "Fix the setup so a commit with real lint errors is blocked.",
        solution:
          "If a bad commit still goes through, the issue is usually not the tool itself. It is the hook installation or configuration path.",
      },
    ],
  },
  {
    id: "integrate-quality-checks-into-daily-workflow",
    title: "Integrate Quality Checks into Daily Workflow",
    body: [
      "Quality tooling only helps if it fits the actual development loop. That means catching obvious issues quickly and leaving the heavier checks to CI when appropriate.",
      "The question is not whether every check is good. The question is where each check belongs.",
    ],
    exercises: [
      {
        id: "exercise-6-15",
        title: "Exercise 6.15: Put Linting Before Tests in CI",
        scenario:
          "The CI workflow runs the full test suite before linting and type checking, even though the style and type steps fail much faster.",
        task:
          "Reorder the workflow so the faster quality gates run first.",
        solution:
          "Run fast quality gates before slower tests in CI. This reduces wasted time and makes failures cheaper to understand.",
      },
      {
        id: "exercise-6-16",
        title: "Exercise 6.16: Decide What Belongs in CI and What Belongs in Pre-Commit",
        scenario:
          "The team wants every check everywhere, but local commits are becoming slow and frustrating.",
        task:
          "Split the quality checks into what should run on every local commit and what should run in CI.",
        solution:
          "Put the fastest, most local checks in pre-commit and keep the full validation path in CI.",
      },
      {
        id: "exercise-6-17",
        title: "Exercise 6.17: Keep Legacy Exceptions Narrow",
        scenario:
          "One module is still messy, and a teammate wants to disable an entire class of lint rules project-wide to make the checks pass.",
        task:
          "Keep the exception narrow enough that the rest of the project still benefits from the rule.",
        solution:
          "If one legacy module needs a temporary exception, scope the exception to that module. Do not weaken the rule for the whole codebase.",
      },
      {
        id: "exercise-6-18",
        title: "Exercise 6.18: Write a Short Quality Policy Note",
        scenario:
          "The team keeps debating whether linting and mypy are optional.",
        task:
          "Write a short note for the README or contributor guide that explains the role of formatting, linting, type checking, and pre-commit in this project.",
        solution:
          "A short quality policy should explain that formatting removes low-value style debate, linting catches common mistakes, type checking catches unclear interfaces, and pre-commit keeps those checks close to the moment the code is written.",
      },
    ],
  },
  {
    id: "what-comes-next",
    title: "What Comes Next",
    body: [
      "In Chapter 7, you move from environment setup to full dependency management so the service can be installed reproducibly across local development, CI, and production builds.",
    ],
  },
];

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export default function BookChapterSixPage() {
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
