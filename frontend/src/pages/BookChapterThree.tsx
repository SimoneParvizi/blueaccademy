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

const chapterTitle = "Chapter 3: The Core Service";

const sections: Section[] = [
  {
    id: "what-this-chapter-is-about",
    title: "What This Chapter Is About",
    body: [
      "By the end of Chapter 2, the project has a working structure. It can be installed, imported, and started in a predictable way. That matters, but it is still only structure.",
      "This chapter is where Load Planning Engine becomes a service. You will implement the planner itself, define the request and status models, expose the first real HTTP endpoints, and separate the business logic from the API layer so the code stays testable as the project grows.",
      "The important thing to notice in this chapter is not just that the service accepts work. It is where each responsibility lives. If the request handler validates the data, persists the request, publishes queue messages, formats the response, and handles every error itself, the service may work for a while. It will also get harder to change with every new feature.",
    ],
  },
  {
    id: "why-this-matters",
    title: "Why This Matters",
    body: [
      "The easiest version of a service is usually the most tangled version.",
      "A request comes in, the handler reads some fields, stores the request, publishes to the queue, and returns JSON. That feels efficient at first because everything is in one place. Then the next change comes in. A status endpoint is added. Validation rules change. Tests start mocking globals. Queue configuration moves into settings. The handler gets longer. Nobody wants to touch it.",
      "This is the point where structure starts to matter inside the application, not just around it. The service layer should know how to plan. The models should know how to validate data. The API layer should know how to receive a request and return a response. Startup should know how to prepare dependencies once instead of rebuilding them on every call.",
    ],
    code: `planning_engine/\n├── pyproject.toml\n├── README.md\n├── src/\n│   └── planning_engine/\n│       ├── __init__.py\n│       ├── app.py\n│       ├── cli.py\n│       ├── settings.py\n│       └── version.py\n└── tests/`,
  },
  {
    id: "shape-the-core-planning-logic",
    title: "Shape the Core Planning Logic",
    body: [
      "The planning code needs a clean boundary before the HTTP layer is added. If the planner has no clear interface, the API code will end up inventing one in the middle of the request path.",
      "That usually starts with small shortcuts. A class does real work in `__init__`. A helper function accepts whatever shape the caller passes. The output is a loose dictionary. Those shortcuts make the first endpoint easy to write and the second one harder.",
    ],
    exercises: [
      {
        id: "exercise-3-1",
        title: "Exercise 3.1: Refactor the Planner Out of __init__",
        scenario:
          "The provided planner class validates shipments, computes the plan, and assigns the final decision label inside `__init__`.",
        task:
          "Refactor the class so initialization only prepares the planner and planning happens in a real method.",
        solution:
          "Keep `__init__` for setup only and expose a method such as `plan(request: PlanningRequest) -> PlanningResult` for the repeated operation.",
      },
      {
        id: "exercise-3-2",
        title: "Exercise 3.2: Define a Clear Service Interface",
        scenario:
          "Different parts of the codebase are calling the planner in different ways. One passes a dictionary, one passes positional values, and one calls a helper function directly.",
        task:
          "Define one clear interface for planning and rewrite the surrounding code to use it.",
        solution:
          "Pick one planning interface and use it everywhere. A single typed method is easier to validate, test, and reuse than several ad hoc calling patterns.",
      },
      {
        id: "exercise-3-3",
        title: "Exercise 3.3: Add Type Hints to the Planning Layer",
        scenario:
          "`planner.py` has almost no type hints. A reviewer says the code is harder to trust because the expected input and output shapes are not obvious.",
        task:
          "Add type hints to the main planning interface and the internal helper methods.",
        solution:
          "Add type hints to the public planning method first, then to the helpers it depends on. The public interface matters most because it teaches both readers and tools what the planner expects.",
      },
    ],
  },
  {
    id: "validate-the-api-contract",
    title: "Validate the API Contract",
    body: [
      "The request and status models are part of the service, not just details of the web framework. If the contract is loose, everything downstream has to guess what shape the data is meant to have.",
      "The job here is to move those assumptions into explicit models and let the service fail early when the data is wrong.",
    ],
    exercises: [
      {
        id: "exercise-3-4",
        title: "Exercise 3.4: Create the Request Model",
        scenario:
          "The endpoint currently accepts raw JSON and reads fields directly from a dictionary.",
        task:
          "Create a request model that defines the expected shipment and planning fields explicitly.",
        solution:
          "Define a typed request model instead of reading raw dictionaries in the route handler. That moves the contract into code the framework can validate.",
      },
      {
        id: "exercise-3-5",
        title: "Exercise 3.5: Create the Status Model",
        scenario:
          "The API currently returns a loose dictionary with inconsistent field order and naming.",
        task:
          "Create a status model for the request ID, state, and optional planning result.",
        solution:
          "A status model keeps the shape of the output stable and makes the server code explicit about what it returns.",
      },
      {
        id: "exercise-3-6",
        title: "Exercise 3.6: Add Field Validation",
        scenario:
          "The request model accepts negative values for fields that should never be negative, and some downstream code assumes valid quantities and dimensions.",
        task:
          "Add validation that rejects invalid shipment values with clear messages.",
        solution:
          "Add validators at the model boundary so invalid inputs fail clearly before they move deeper into the service.",
      },
      {
        id: "exercise-3-7",
        title: "Exercise 3.7: Reject Impossible Planning Results",
        scenario:
          "The planner can currently return impossible outputs such as negative stop counts or a load percentage above `1.0` without any explicit error.",
        task:
          "Add a validation rule or guard so impossible planning results fail clearly.",
        solution:
          "Validate the result before returning it, either in the planner or in the status model, so impossible plans fail explicitly.",
      },
    ],
  },
  {
    id: "build-the-http-layer-without-tangling-it",
    title: "Build the HTTP Layer Without Tangling It",
    body: [
      "The route layer should be small enough that you can understand it by looking at it once. Its job is to accept a validated request, call the request service, and return the validated response.",
      "Once the route starts owning business logic, it becomes harder to test and harder to extend. That is the pattern to avoid in this section.",
    ],
    exercises: [
      {
        id: "exercise-3-8",
        title: "Exercise 3.8: Add the POST /planning-requests Endpoint",
        scenario:
          "The project has no real API route yet. The team wants the first endpoint to accept validated input, publish work, and return a typed accepted response.",
        task:
          "Implement `POST /planning-requests` using the request service and the request and accepted-response models.",
        solution:
          "The route should accept the typed request model, receive the request service through a dependency, and return the typed accepted-response model.",
      },
      {
        id: "exercise-3-9",
        title: "Exercise 3.9: Return the Right HTTP Error for Bad Input",
        scenario:
          "The endpoint currently returns HTTP 200 with an error message inside the response body when the request payload is invalid.",
        task:
          "Fix the behavior so invalid input produces the correct HTTP error response.",
        solution:
          "Invalid request input should produce an HTTP validation error, not a successful response that happens to contain an error message.",
      },
      {
        id: "exercise-3-10",
        title: "Exercise 3.10: Separate Router and App Setup",
        scenario:
          "All API setup lives in one file, including route definitions, application creation, and startup behavior.",
        task:
          "Split the code so the router and the application setup have separate responsibilities.",
        solution:
          "Keep route definitions in `api/router.py` and application creation in `api/app.py` so one file does not become the home for every API concern.",
      },
      {
        id: "exercise-3-11",
        title: "Exercise 3.11: Implement GET /planning-requests/{request_id}",
        scenario:
          "The team wants a status endpoint, but the business logic for one planning request should stay the same.",
        task:
          "Implement `GET /planning-requests/{request_id}` by reusing the existing request lookup path instead of inventing a second representation.",
        solution:
          "The status endpoint should reuse the same request lookup path as the rest of the service. It is not a reason to duplicate business logic.",
      },
    ],
  },
  {
    id: "move-real-dependencies-to-startup",
    title: "Move Real Dependencies to Startup",
    body: [
      "The route should not keep repeating work that can be done once when the application starts. Queue clients and request repositories are the clearest examples in this chapter.",
      "This is also where dependency injection starts paying off. It gives the application one place to prepare the request service and gives the tests one place to override it.",
    ],
    exercises: [
      {
        id: "exercise-3-12",
        title: "Exercise 3.12: Stop Building Queue Dependencies Inside the Request Handler",
        scenario:
          "The queue client and request repository are built inside the request handler on every call.",
        task:
          "Move dependency setup to startup so the request path only uses already prepared services.",
        solution:
          "Build the queue client and request service at startup, then reuse them through dependency injection.",
      },
      {
        id: "exercise-3-13",
        title: "Exercise 3.13: Add a Dependency Provider",
        scenario:
          "The route imports a module-level request service instance directly. Tests now have to patch global state to change its behavior.",
        task:
          "Add a dependency function that provides the request service to the route.",
        solution:
          "A dependency provider such as `get_request_service()` gives the route a clean interface and gives tests a clean override point.",
      },
      {
        id: "exercise-3-14",
        title: "Exercise 3.14: Add GET /planning-service/info",
        scenario:
          "The team wants a simple endpoint that exposes the queue backend, planning profile version, and startup time without leaking internal connection details.",
        task:
          "Implement `GET /planning-service/info` using the already prepared service dependency.",
        solution:
          "Return safe metadata such as queue backend, planning profile version, and when the service was prepared. Do not return internal connection details unless there is a reason to expose them.",
      },
    ],
  },
  {
    id: "keep-the-service-testable",
    title: "Keep the Service Testable",
    body: [
      "The application structure should help the test suite, not fight it. If tests keep patching module-level globals, the code is often telling you that the dependency boundaries are still wrong.",
      "The goal here is not an elaborate testing framework. It is a service shape that gives tests clean seams to work with.",
    ],
    exercises: [
      {
        id: "exercise-3-15",
        title: "Exercise 3.15: Replace Global Patching with Dependency Overrides",
        scenario:
          "A test suite is patching module-level globals to replace the request service during API tests.",
        task:
          "Update the tests to use FastAPI dependency overrides instead.",
        solution:
          "Use dependency overrides so the application can receive a fake request service without patching global variables.",
      },
      {
        id: "exercise-3-16",
        title: "Exercise 3.16: Fail Clearly When Startup Dependencies Are Missing",
        scenario:
          "If the queue configuration is missing, the service crashes with an unclear traceback during startup.",
        task:
          "Make the failure clear enough that the operator can tell what is missing without reading source code.",
        solution:
          "Catch missing startup dependencies early and raise a clear message such as `Queue backend is not configured: set QUEUE_URL before starting the service`.",
      },
    ],
  },
  {
    id: "what-comes-next",
    title: "What Comes Next",
    body: [
      "In Chapter 4, you replace hardcoded values and ad hoc settings with a real configuration system that works across local development, CI, and production.",
    ],
  },
];

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export default function BookChapterThreePage() {
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
