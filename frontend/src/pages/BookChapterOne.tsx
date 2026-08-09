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
  quote?: string;
  exercises?: Exercise[];
};

const chapterTitle = "Chapter 1: The Assignment";

const sections: Section[] = [
  {
    id: "what-this-chapter-is-about",
    title: "What This Chapter Is About",
    body: [
      "Before you write code for a service, you need to know what problem the service is supposed to solve, what constraints it will live under, and what is still unclear. That sounds obvious, but a lot of projects skip this step and pay for it later.",
      "This chapter is about reading the brief before you start building. You are given the first version of the Load Planning Engine assignment and asked to do the work that usually happens before the first commit: identify ambiguity, separate real requirements from scope drift, choose a direction, and record the decisions clearly enough that someone else can review them.",
      "This is the shortest chapter in the book. It is also one of the most useful. If you get this part wrong, the rest of the project can be well built and still be the wrong project.",
    ],
  },
  {
    id: "why-this-matters",
    title: "Why This Matters",
    body: [
      "A lot of bad engineering work is not bad because the code is sloppy. It is bad because the team started implementing before they were clear on what they were implementing.",
      "The common version of this looks familiar. A requirement says `low latency` without defining whether that means request acceptance or full processing time. A product note says the service should handle peak demand without saying whether that means more API pods, more workers, or replay jobs.",
      "Then the code starts. A week later, the team is arguing about behavior that should have been resolved before the project structure even existed. Chapter 1 is where you slow that down just enough to avoid building on assumptions you have not checked.",
    ],
  },
  {
    id: "the-assignment",
    title: "The Assignment",
    body: [
      "You have joined a small team that needs to ship a Python service called Load Planning Engine.",
      "The service accepts planning requests for existing shipments over HTTP. It validates the request, stores its initial state, publishes work to a queue, and returns `202 Accepted` with a request ID. A worker classifies the shipment set and computes the actual planning decision afterward.",
      "The first version should be simple enough to ship quickly, but the team already knows it will eventually need tests, containerization, CI, configuration by environment, worker processes, and a deployment target on Kubernetes.",
      "That is enough to start thinking. It is not enough to start building without questions.",
    ],
    quote:
      "Build a service that exposes a `POST /planning-requests` endpoint for existing shipments. The API should validate the request, accept it for processing, publish work to a queue, and return a request ID immediately. Clients should be able to check status later. The service should be fast, easy to extend, and production-ready. It should support local development now and cloud deployment later. The initial release should be small, but the design should leave room for worker scaling, backlog replay, and peak-time replanning.",
  },
  {
    id: "read-the-brief-carefully",
    title: "Read the Brief Carefully",
    body: [
      "Most of the work in this chapter is written rather than coded. You are reading a brief, finding the unclear parts, and deciding what deserves a real decision now. That work still changes what the code becomes.",
    ],
    exercises: [
      {
        id: "exercise-1-1",
        title: "Exercise 1.1: Find the Ambiguous Requirements",
        scenario:
          "You are given the product brief above and asked to start implementation the same day.",
        task:
          "Identify three requirements that are too vague to implement confidently and write one clarifying question for each.",
        hint:
          "Look for words that sound useful but do not give you a measurable target.",
        solution:
          "A good starting set is `fast`, `easy to extend`, and `production-ready`. Each one needs a concrete question before it can guide implementation.",
      },
      {
        id: "exercise-1-2",
        title: "Exercise 1.2: Separate Launch Scope from Future Scope",
        scenario:
          "The brief mixes launch needs with later ideas such as replay tooling, monitoring, and peak-time replanning.",
        task:
          "Split the brief into two lists: what must exist in the first release, and what should be treated as later scope unless a stakeholder says otherwise.",
        solution:
          "The first release needs a request-submission endpoint, a status lookup path, local setup, and a structure that can grow. Replay tooling and scheduled replanning belong in later scope unless someone makes them explicit launch requirements.",
      },
      {
        id: "exercise-1-3",
        title: "Exercise 1.3: Define Production-Ready in Concrete Terms",
        scenario:
          "A stakeholder says the service should be production-ready. Nobody explains what that means.",
        task:
          "Write three concrete checks you would use to decide whether the first version is ready to move beyond local development.",
        solution:
          "Reasonable checks include a documented setup path, a clear request and response contract, and enough operational structure to support testing, configuration, and packaging.",
      },
    ],
  },
  {
    id: "challenge-weak-technical-decisions",
    title: "Challenge Weak Technical Decisions",
    body: [
      "Early design mistakes often look sensible because they borrow familiar words from larger systems. The question is not whether a design sounds scalable. The question is whether it matches the requirement you actually have.",
    ],
    exercises: [
      {
        id: "exercise-1-4",
        title: "Exercise 1.4: Reject the Wrong Architecture",
        scenario:
          "A teammate proposes a fully synchronous design where the request is validated, planned, and written before the response is returned. The brief still calls for `202 Accepted`, queue publishing, and later status checks.",
        task:
          "Write a short review comment explaining why this design does not match the requirement and what design should replace it.",
        hint:
          "Do not argue that synchronous work is always bad. Argue that this design solves a different problem.",
        solution:
          "The design changes the product behavior from accepted-for-processing to synchronous completion. The correct fit is an API that validates, persists, publishes to the queue, and returns a request ID immediately.",
      },
      {
        id: "exercise-1-5",
        title: "Exercise 1.5: Pick a Framework and Defend It",
        scenario:
          "The team is choosing between FastAPI and Flask for the first version of the service.",
        task:
          "Write a short decision note that chooses one option and explains the trade-off in plain language.",
        hint:
          "Do not argue from popularity. Argue from the actual service requirements.",
        solution:
          "A reasonable choice is FastAPI because the service is HTTP-first, needs request and status validation, and will benefit from typed models as the project grows.",
      },
    ],
  },
  {
    id: "make-the-first-real-decisions",
    title: "Make the First Real Decisions",
    body: [
      "The first project decisions do not need to be long. They do need to be legible. Someone else should be able to read them later and understand what was chosen and why.",
    ],
    exercises: [
      {
        id: "exercise-1-6",
        title: "Exercise 1.6: Write the First ADR",
        scenario:
          "The team wants one short record of the first important decision so later changes can be compared against it.",
        task:
          "Write `ADR-001` for the framework choice. Include context, decision, and consequences.",
        solution:
          "The ADR should state that Load Planning Engine needs an HTTP endpoint for accepted planning requests, that FastAPI is the chosen framework, and that the trade-off is a little more framework structure in exchange for clearer API handling.",
      },
      {
        id: "exercise-1-7",
        title: "Exercise 1.7: Define Initial Service Boundaries",
        scenario:
          "People keep adding small ideas to the first release: authentication, a database, route optimization, a large operator dashboard, and multi-region scheduling.",
        task:
          "Write a short note that defines what the first version of Load Planning Engine will do and what it will explicitly not do.",
        solution:
          "The first version should accept planning requests over HTTP, persist request state, publish work to a queue, and expose a status endpoint. It should not include authentication, complex optimization beyond the first planning rules, a broad admin UI, or multi-region scheduling.",
      },
    ],
  },
  {
    id: "start-the-project-cleanly",
    title: "Start the Project Cleanly",
    body: [
      "Once the brief is understood and the first decisions are written down, you can start the repository without guessing. The main point here is not to create a large scaffold. It is to create just enough structure that the next chapter has a stable place to start.",
    ],
    exercises: [
      {
        id: "exercise-1-8",
        title: "Exercise 1.8: Plan the Initial Repository",
        scenario:
          "You are about to create the repository and make the first commit.",
        task:
          "List the minimum set of files and directories you want before implementation starts, based on what you already know from the brief and from the next chapter.",
        solution:
          "A sensible minimum is `README.md`, `pyproject.toml`, `src/planning_engine/`, `tests/`, and `docs/decisions/` with the first ADR.",
      },
      {
        id: "exercise-1-9",
        title: "Exercise 1.9: Write the First README Opening",
        scenario:
          "The repository is empty except for a title. The next engineer who opens it should understand what the project is for.",
        task:
          "Write the opening section of `README.md` in three short paragraphs or fewer.",
        solution:
          "The opening should explain that Load Planning Engine is a Python planning service, that it accepts requests and processes them asynchronously, and that the repository follows the service through the steps needed to run it reliably.",
      },
    ],
  },
  {
    id: "what-comes-next",
    title: "What Comes Next",
    body: [
      "In Chapter 2, you create the actual project structure for Load Planning Engine. That is where the repository stops being a plan and starts becoming a codebase.",
    ],
  },
];

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export default function BookChapterOnePage() {
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

                {section.quote ? (
                  <blockquote className="book-blockquote">
                    <p>{renderInlineCode(section.quote)}</p>
                  </blockquote>
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
