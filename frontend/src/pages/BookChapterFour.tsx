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

const chapterTitle = "Chapter 4: Configuration Done Right";

const sections: Section[] = [
  {
    id: "what-this-chapter-is-about",
    title: "What This Chapter Is About",
    body: [
      "By the end of Chapter 3, Load Planning Engine can start, accept requests, and return plans. It is a service now. It is also still tied too closely to the machine where it was built.",
      "The queue URL is hardcoded in one file. The port is set directly in another. A local environment variable works on one laptop because someone exported it months ago and forgot about it. The service looks configurable until you try to move it to a different machine.",
      "This chapter is about fixing that. You will move the service to a proper configuration model, separate settings from secrets, add layered configuration for different environments, and make startup fail clearly when required values are missing or invalid.",
    ],
  },
  {
    id: "why-this-matters",
    title: "Why This Matters",
    body: [
      "Configuration problems usually look small until the service has to move.",
      "A queue URL works on one machine because Redis happens to be running there. A port is hardcoded because there was only one local process at the time. A token is read from a `.env` file that nobody meant to commit. None of this feels dramatic while the service stays on one laptop. Then the first staging environment arrives and the service starts breaking for reasons that are hard to see from the code alone.",
      "This is why configuration belongs early in the lifecycle of the service. It is not an ops detail that can be added at the end. It changes how the application starts, how it fails, and how it moves between local development, CI, staging, and production.",
    ],
    code: `QUEUE_URL = "redis://localhost:6379/0"\nPORT = 8000\nDEFAULT_UTILIZATION_LIMIT = 0.72`,
  },
  {
    id: "move-hardcoded-values-into-settings",
    title: "Move Hardcoded Values into Settings",
    body: [
      "The first step is simple. Stop scattering important values through the code. If the queue URL or the utilization limit lives in three places, someone will eventually change one and miss the others.",
      "A settings model gives those values one home and gives the rest of the application one place to read them from.",
    ],
    exercises: [
      {
        id: "exercise-4-1",
        title: "Exercise 4.1: Centralize RULES_PATH",
        scenario:
          "`RULES_PATH` appears as a hardcoded string in three different files.",
        task:
          "Move it into a typed settings object and update all references.",
        solution:
          "Create a typed settings object and move `RULES_PATH` into it so the rest of the code stops reading scattered hardcoded strings.",
      },
      {
        id: "exercise-4-2",
        title: "Exercise 4.2: Centralize the Service Port",
        scenario:
          "The HTTP port is hardcoded in the application startup code and cannot be changed without editing the source.",
        task:
          "Move the port into the settings model so the service can be started on different ports without code changes.",
        solution:
          "The service port should be part of the settings model so startup behavior can change without touching the source.",
      },
      {
        id: "exercise-4-3",
        title: "Exercise 4.3: Add a Default Threshold Setting",
        scenario:
          "The service uses an inline numeric utilization limit to decide when a vehicle is treated as full, but nobody can tell where that value should be changed safely.",
        task:
          "Move the utilization limit into the settings model with a sensible default.",
        solution:
          "Thresholds that control business behavior should live in configuration, not inside arbitrary code branches.",
      },
    ],
  },
  {
    id: "validate-configuration-at-startup",
    title: "Validate Configuration at Startup",
    body: [
      "Configuration is easier to trust when it fails early. If required values silently become `None`, the service may still start and then fail later in a way that is harder to trace back to the real cause.",
      "This section is about moving obvious configuration failures to startup, where they are easier to diagnose.",
    ],
    exercises: [
      {
        id: "exercise-4-4",
        title: "Exercise 4.4: Fail Clearly on Missing Required Settings",
        scenario:
          "The current settings loader silently accepts `None` for values that are actually required.",
        task:
          "Change the behavior so the service exits with a clear startup error when required configuration is missing.",
        solution:
          "Required settings should fail at startup with a clear message. Silent `None` values move the bug deeper into the application.",
      },
      {
        id: "exercise-4-5",
        title: "Exercise 4.5: Reject Invalid Numeric Configuration",
        scenario:
          "A threshold value is loaded from configuration as `1.8`, and the service starts without complaint even though the logic expects values between `0` and `1`.",
        task:
          "Add validation so invalid numeric settings fail early.",
        solution:
          "Numeric configuration should be validated at the settings boundary. If the valid range is `0` to `1`, then `1.8` should never reach the running service.",
      },
      {
        id: "exercise-4-6",
        title: "Exercise 4.6: Handle Invalid Paths Explicitly",
        scenario:
          "The settings object accepts a queue URL that is empty. The error only appears later when a request tries to publish work.",
        task:
          "Move that failure earlier so the service refuses to start with an invalid queue configuration.",
        solution:
          "Model paths should be checked before the service starts serving requests. The operator should learn the path is wrong during startup.",
      },
    ],
  },
  {
    id: "add-structured-configuration-files",
    title: "Add Structured Configuration Files",
    body: [
      "Not every setting belongs in a separate environment variable. Some configuration is grouped and structured enough that a file is the better fit.",
      "The common mistake is to add a config file and then bypass validation. The better path is to load structured config and still pass it through the same typed settings boundary.",
    ],
    exercises: [
      {
        id: "exercise-4-7",
        title: "Exercise 4.7: Introduce config.yaml",
        scenario:
          "Some settings are not a good fit for individual environment variables, especially grouped values such as capacity profiles, queue names, or replanning windows.",
        task:
          "Introduce a YAML config file for structured settings and load it alongside the typed settings model.",
        solution:
          "Use YAML for grouped structured configuration, but keep the typed settings model as the validated entry point.",
      },
      {
        id: "exercise-4-8",
        title: "Exercise 4.8: Fix Incorrect YAML Parsing",
        scenario:
          "A YAML value that should be a float is loaded as a string and causes a downstream `TypeError`.",
        task:
          "Fix the parsing path and add validation so type mismatches are caught where the config is loaded.",
        solution:
          "Catch type mismatches when the YAML is loaded instead of letting them surface later in unrelated code.",
      },
      {
        id: "exercise-4-9",
        title: "Exercise 4.9: Split Config by Environment",
        scenario:
          "The team wants different config files for `local`, `staging`, and `production`, but the loader always reads the same file.",
        task:
          "Add support for a `CONFIG_ENV` setting that selects the right config file.",
        solution:
          "Use a setting such as `CONFIG_ENV=local|staging|production` to choose which file to load.",
      },
      {
        id: "exercise-4-10",
        title: "Exercise 4.10: Define a Clear Precedence Order",
        scenario:
          "Nobody can answer which source wins when the same value exists in defaults, YAML, and environment variables.",
        task:
          "Define and implement a precedence order for configuration sources.",
        solution:
          "A reasonable order is defaults, then YAML, then environment variable overrides. Write it down and keep it consistent.",
      },
    ],
  },
  {
    id: "separate-secrets-from-settings",
    title: "Separate Secrets from Settings",
    body: [
      "The useful distinction here is simple. Settings describe runtime behavior and are usually safe to log or commit. Secrets grant access or expose sensitive capability and should not be logged or committed.",
      "Once those two categories are mixed together, the service becomes harder to operate and easier to leak.",
    ],
    exercises: [
      {
        id: "exercise-4-11",
        title: "Exercise 4.11: Identify Which Values Are Secrets",
        scenario:
          "The service now uses both runtime settings and external credentials, but they are all treated the same way in code and documentation.",
        task:
          "Classify the current configuration values into settings and secrets, and state the rule you are using.",
        solution:
          "Settings describe runtime behavior and are generally safe to log or commit. Secrets grant access and should not be logged or committed.",
      },
      {
        id: "exercise-4-12",
        title: "Exercise 4.12: Add .env.example",
        scenario:
          "New engineers do not know which environment variables the service expects.",
        task:
          "Create a `.env.example` file that documents the expected variables without containing real credentials.",
        solution:
          "`.env.example` should show expected variable names and placeholder values only. Its job is documentation, not secret storage.",
      },
      {
        id: "exercise-4-13",
        title: "Exercise 4.13: Remediate a Committed .env File",
        scenario:
          "A `.env` file containing credentials was committed to Git.",
        task:
          "Write the remediation steps and the repository changes needed to prevent it from happening again.",
        solution:
          "Rotate the leaked credentials, remove the file from version control, add `.env` to `.gitignore`, and keep only `.env.example` in the repository.",
      },
      {
        id: "exercise-4-14",
        title: "Exercise 4.14: Exclude Secrets from Debug Output",
        scenario:
          "A debug endpoint is about to expose the entire settings object as JSON, including sensitive values.",
        task:
          "Implement a way to expose safe configuration for debugging without returning secrets.",
        solution:
          "Do not serialize the full settings object blindly. Provide a safe representation that excludes secrets.",
      },
    ],
  },
  {
    id: "make-configuration-testable-and-operable",
    title: "Make Configuration Testable and Operable",
    body: [
      "Configuration code should not create the same kind of hidden global state you just avoided in the service layer. Tests should be able to provide settings without mutating shared module state.",
      "Operators also need a small amount of visibility. They do not need every raw setting, but they do need to know which environment the service thinks it is running in and which safe config values are active.",
    ],
    exercises: [
      {
        id: "exercise-4-15",
        title: "Exercise 4.15: Remove the Global Settings Singleton",
        scenario:
          "The config system relies on a global singleton, and parallel tests now interfere with each other when settings are changed.",
        task:
          "Refactor the configuration path so tests can provide settings without mutating global state.",
        solution:
          "Replace the global singleton with a settings provider or dependency function so tests can supply configuration directly.",
      },
      {
        id: "exercise-4-16",
        title: "Exercise 4.16: Add a Feature Flag for Batch Scoring",
        scenario:
          "The team wants to disable the batch endpoint in some environments without removing the code or redeploying a special branch.",
        task:
          "Add a configuration flag that controls whether the batch endpoint is available.",
        solution:
          "Use a flag such as `BATCH_SCORING_ENABLED` so the batch path can be enabled or disabled without source changes.",
      },
      {
        id: "exercise-4-17",
        title: "Exercise 4.17: Add a Safe Config Debug Endpoint",
        scenario:
          "Operators need a way to confirm which non-sensitive configuration values the running service is using.",
        task:
          "Add a `GET /config` endpoint that returns safe configuration values only.",
        solution:
          "`GET /config` should return only safe values. The point is operational visibility, not total introspection.",
      },
      {
        id: "exercise-4-18",
        title: "Exercise 4.18: Make Startup Logs Useful",
        scenario:
          "When the service starts, it gives no clear signal about which environment or config profile it loaded.",
        task:
          "Add startup logging that confirms the active environment and config sources without printing secrets.",
        solution:
          "Startup logs should confirm which config profile was loaded and which non-secret sources were used.",
      },
    ],
  },
  {
    id: "what-comes-next",
    title: "What Comes Next",
    body: [
      "In Chapter 5, you build a test suite that proves the service behaves the way you think it does, including the new configuration paths you just introduced.",
    ],
  },
];

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export default function BookChapterFourPage() {
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
