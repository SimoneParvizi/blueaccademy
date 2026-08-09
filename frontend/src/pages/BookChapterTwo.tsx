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

const chapterTitle = "Chapter 2: Structure First";

const sections: Section[] = [
  {
    id: "what-this-chapter-is-about",
    title: "What This Chapter Is About",
    body: [
      "The first version of Load Planning Engine does not need Docker, Kubernetes, or CI yet. It needs a project structure that behaves the same way for everyone who works on it.",
      "Right now, it does not. Imports only work from some directories. The entry point is mixed with application code. The package is not installable. Setup depends on what happens to be installed on one machine.",
      "In this chapter, you fix that. You move the code into a `src/` layout, make the package installable, set up an isolated environment, and give the project a clear entry point. By the end, a new engineer should be able to clone the repository, follow the README, and get the same result you do.",
    ],
  },
  {
    id: "why-structure-matters",
    title: "Why Structure Matters",
    body: [
      "A lot of early Python projects work under one condition: the author is standing in the repository root and already has the right packages installed. That is usually what people mean when they say the code works.",
      "That is not enough once a second person touches the project. The package should install into its own environment. Imports should work because the package is defined properly. The supported way to run the service should be obvious. The README should answer the first setup questions before anyone asks them.",
      "This is why structure shows up early in the book. It is not cleanup work for later. It affects how every chapter after this one will be built.",
    ],
    code: `planning_engine/\n├── app.py\n├── planner.py\n├── settings.py\n├── version.py\n└── util.py`,
  },
  {
    id: "put-the-package-in-the-right-place",
    title: "Put the Package in the Right Place",
    body: [
      "The first problem is the flat layout. Everything lives at the top level, so the project depends on the working directory more than it should. That is why imports start breaking as soon as the code is installed or moved.",
      "The fix is not just moving files. The fix is making the package boundary explicit and importing through it consistently. This is also the point where it helps to keep `__init__.py` empty. If the package does not need a public API yet, there is no reason to pretend it does.",
    ],
    exercises: [
      {
        id: "exercise-2-1",
        title: "Exercise 2.1: Move from Flat Layout to src/",
        scenario:
          "You inherit a project where `app.py`, `planner.py`, `settings.py`, and `version.py` all sit in the repository root. Imports are written as `from planner import PlanningService` and only work when the app is started from that directory.",
        task:
          "Restructure the project into a `src/planning_engine/` layout and update the imports so they describe the package boundary explicitly.",
        hint:
          "The directory move is not enough. The imports are part of the exercise.",
        solution:
          "Move the application files into `src/planning_engine/`, add an empty `src/planning_engine/__init__.py`, and update imports to forms like `from planning_engine.planner import PlanningService` and `from planning_engine.settings import load_settings`.",
      },
      {
        id: "exercise-2-2",
        title: "Exercise 2.2: Fix the Broken Import",
        scenario:
          "After the move, `src/planning_engine/planner.py` still imports `Settings` as `from settings import Settings`, and tests now fail outside the repository root.",
        task:
          "Fix the import so it works in an installed package.",
        solution:
          "Import through the package boundary: `from planning_engine.settings import Settings`.",
      },
      {
        id: "exercise-2-3",
        title: "Exercise 2.3: Keep __init__.py Boring",
        scenario:
          "A teammate wants to put version exports, helper imports, and startup logic into `src/planning_engine/__init__.py` because it seems convenient.",
        task:
          "Reject that design and state what `__init__.py` should contain at this stage of the project.",
        hint:
          "Do not invent a package API before the package needs one.",
        solution:
          "Keep `__init__.py` empty. At this stage it only marks the directory as a package boundary. Startup logic, helper re-exports, and version access belong in explicit modules, not hidden import side effects.",
      },
      {
        id: "exercise-2-4",
        title: "Exercise 2.4: Add the Missing Package Boundary",
        scenario:
          "You now have `src/planning_engine/api/router.py` and `src/planning_engine/api/dependencies.py`, but the `api/` directory does not contain `__init__.py`.",
        task:
          "Make the package boundary explicit.",
        solution:
          "Add an empty `src/planning_engine/api/__init__.py` so the package structure is clear to tooling and to the reader.",
      },
      {
        id: "exercise-2-5",
        title: "Exercise 2.5: Stop Running the App Like a Script",
        scenario:
          "A developer starts the app with `python src/planning_engine/app.py`. It works locally and fails elsewhere.",
        task:
          "Replace this with an invocation that respects package semantics.",
        solution:
          "Use `python -m planning_engine.app`, or better yet a console script later in the chapter.",
      },
    ],
  },
  {
    id: "make-the-project-installable",
    title: "Make the Project Installable",
    body: [
      "A project like this needs to be installable. A few source files and a `requirements.txt` are enough to get started, but they are not enough once other people need to work on the same code.",
      "This is where `pyproject.toml`, editable installs, and isolated environments start to matter. They make local development closer to the way the package will behave outside your own repository folder.",
    ],
    code: `[build-system]\nrequires = ["setuptools>=68", "wheel"]\nbuild-backend = "setuptools.build_meta"\n\n[project]\nname = "planning_engine"\nversion = "0.1.0"\ndescription = "A production-minded logistics planning service."\nreadme = "README.md"\nrequires-python = ">=3.11"\n\n[tool.setuptools]\npackage-dir = {"" = "src"}`,
    exercises: [
      {
        id: "exercise-2-6",
        title: "Exercise 2.6: Create a Minimal pyproject.toml",
        scenario:
          "The repository still depends on a loose `requirements.txt` and has no build metadata. Another engineer cannot install the package with `pip install -e .`.",
        task:
          "Write the minimum `pyproject.toml` needed to install the project from a `src/` layout.",
        hint:
          "You need build-system metadata and package discovery from `src`.",
        solution:
          "Use `setuptools.build_meta`, define the project metadata under `[project]`, and configure `[tool.setuptools] package-dir = {\"\" = \"src\"}` with package discovery under `src`.",
      },
      {
        id: "exercise-2-7",
        title: "Exercise 2.7: Fix Broken Metadata",
        scenario:
          "The project metadata says `name = \"Load Planning Engine Service\"`, `version = 1`, and `description = [\"logistics planning service\"]`.",
        task:
          "Correct the metadata so `pip install -e .` can succeed.",
        solution:
          "Use normalized string values such as `name = \"load-planning-engine\"`, `version = \"0.1.0\"`, and a string description.",
      },
      {
        id: "exercise-2-8",
        title: "Exercise 2.8: Install in Editable Mode",
        scenario:
          "The project has build metadata now, but the package is still not available in the local environment.",
        task:
          "Write the setup commands using `venv` and `pip` so another engineer can start working safely.",
        solution:
          "Create `.venv`, activate it, upgrade `pip`, and run `python -m pip install -e .`.",
      },
      {
        id: "exercise-2-9",
        title: "Exercise 2.9: Prove That the Editable Install Matters",
        scenario:
          "A teammate says editable installs are unnecessary because importing `planning_engine.app` works from the repository root.",
        task:
          "Explain why that test is weak and show how to expose the mistake.",
        hint:
          "The repository root can hide packaging failures by landing on `sys.path`.",
        solution:
          "Change into a different directory such as `/tmp` and try the import again. If it only works after `pip install -e .`, the editable install is doing real work and the original test was misleading.",
      },
    ],
  },
  {
    id: "build-an-environment-that-does-not-leak",
    title: "Build an Environment That Does Not Leak",
    body: [
      "A project environment should belong to the project, not to whatever happens to be installed on one laptop. That is the difference between a setup someone can repeat and a setup someone can only inherit by accident.",
      "This part of the chapter is mostly about removing hidden dependencies. If the service only works because one engineer already installed the right packages globally, the setup is still broken.",
    ],
    exercises: [
      {
        id: "exercise-2-10",
        title: "Exercise 2.10: Stop Using System Python",
        scenario:
          "One engineer installed FastAPI globally. Another did not. They disagree about whether the project setup is broken.",
        task:
          "Write the correct principle and the correct local setup.",
        solution:
          "The project should define its own environment. Use a local virtual environment and install dependencies there instead of relying on system Python.",
      },
      {
        id: "exercise-2-11",
        title: "Exercise 2.11: Switch the Workflow to uv",
        scenario:
          "The team decides to use `uv` for local environment setup instead of raw `pip` commands.",
        task:
          "Write the equivalent setup commands.",
        solution:
          "Use `uv venv`, activate `.venv`, and install with `uv pip install -e .` or `uv pip install -e \".[dev]\"`.",
      },
      {
        id: "exercise-2-12",
        title: "Exercise 2.12: Write the .gitignore",
        scenario:
          "The repository contains `.venv/`, `__pycache__/`, `.pytest_cache/`, and `dist/` artifacts in version control.",
        task:
          "Write the `.gitignore` entries that should have prevented this.",
        solution:
          "Ignore `.venv/`, `__pycache__/`, `*.py[cod]`, `.pytest_cache/`, `dist/`, `build/`, and `*.egg-info/`.",
      },
      {
        id: "exercise-2-13",
        title: "Exercise 2.13: Separate Runtime and Dev Dependencies",
        scenario:
          "`pytest`, `ruff`, and `mypy` were added to the main dependency list.",
        task:
          "Move them to the right place in `pyproject.toml` and show the install command.",
        solution:
          "Keep runtime dependencies under `[project].dependencies` and move development tools to `[project.optional-dependencies].dev`, then install with `python -m pip install -e \".[dev]\"`.",
      },
    ],
  },
  {
    id: "expose-real-entry-points",
    title: "Expose Real Entry Points",
    body: [
      "A service should have a supported way to start it. If the startup command only exists as a long module path someone remembers from habit, the project is harder to use than it needs to be.",
      "The point is not convenience alone. A clear entry point also makes the structure of the application more obvious.",
    ],
    exercises: [
      {
        id: "exercise-2-14",
        title: "Exercise 2.14: Add a Version Constant Without Polluting __init__.py",
        scenario:
          "The version string appears in several places, and someone suggests re-exporting it from `__init__.py`.",
        task:
          "Choose a cleaner structure that keeps `__init__.py` empty.",
        solution:
          "Put `__version__ = \"0.1.0\"` in `src/planning_engine/version.py` and import it from there where needed.",
      },
      {
        id: "exercise-2-15",
        title: "Exercise 2.15: Add a CLI Entry Point",
        scenario:
          "Developers currently start the project with a long module path command nobody remembers.",
        task:
          "Create a console script named `load-planning-engine` that prints the version and a short startup summary.",
        solution:
          "Add `[project.scripts] load-planning-engine = \"planning_engine.cli:main\"` and create a thin `cli.py` that prints the version and key settings.",
      },
      {
        id: "exercise-2-16",
        title: "Exercise 2.16: Keep the CLI Thin",
        scenario:
          "A teammate wants to move service logic and rules loading into `cli.py` because that is where the app starts.",
        task:
          "Refactor or design the CLI so it only orchestrates.",
        hint:
          "Entry points should compose behavior, not become the behavior.",
        solution:
          "Keep `cli.py` small and move reusable logic into `app.py` or other modules that tests and future HTTP startup hooks can call directly.",
      },
    ],
  },
  {
    id: "write-documentation-that-reduces-support-requests",
    title: "Write Documentation That Reduces Support Requests",
    body: [
      "A README with only a title creates work for the next person. They still need to know which Python version to use, how to install the package, how to run it, and how to tell whether setup worked.",
      "The right README here is short. It covers requirements, setup, run commands, test commands, and one quick verification step. That is enough to remove most of the predictable setup questions.",
    ],
    exercises: [
      {
        id: "exercise-2-17",
        title: "Exercise 2.17: Replace the Empty README.md",
        scenario:
          "The repository README contains only `# Load Planning Engine`. A new engineer asks how to start the project and how to verify setup.",
        task:
          "Replace the README with one that covers setup, run, tests, and a short verification section.",
        hint:
          "A README is an operational file, not decoration.",
        solution:
          "Add requirements, setup commands, the supported way to run the CLI, a test command, and a `Verify Your Setup` section that uses quick commands like `load-planning-engine` and `pytest`.",
      },
      {
        id: "exercise-2-18",
        title: "Exercise 2.18: Explain the src Layout Choice",
        scenario:
          "A reviewer asks why the package is under `src/` instead of sitting at the repository root.",
        task:
          "Write the shortest defensible explanation for the README or an ADR.",
        solution:
          "Explain that `src/` prevents the repository root from hiding packaging mistakes and makes local imports behave more like installed code.",
      },
      {
        id: "exercise-2-19",
        title: "Exercise 2.19: Add a Setup Verification Step",
        scenario:
          "You want a new engineer to know within a minute whether local setup succeeded.",
        task:
          "Add a short verification section to the README.",
        solution:
          "Add a `Verify Your Setup` section with a small command pair such as `load-planning-engine` and `pytest`.",
      },
    ],
  },
  {
    id: "what-comes-next",
    title: "What Comes Next",
    body: [
      "In Chapter 3, you start adding real service behavior on top of this structure. You will implement the planner, define request and status models, and build the first application layer around them.",
    ],
  },
];

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export default function BookChapterTwoPage() {
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
