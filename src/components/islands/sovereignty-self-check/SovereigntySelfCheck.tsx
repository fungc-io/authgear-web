import { useEffect, useRef, useState } from 'react';
import { trackEvent } from '@/lib/plausible';
import './SovereigntySelfCheck.css';
import {
  ANSWER_OPTIONS,
  BANDS,
  GAP_LABEL,
  GROUPS,
  NO_GAPS,
  QUESTIONS,
  band,
  gaps,
  pointerText,
  resultText,
  score,
  type Answer,
} from './selfCheckData';

type Answers = Partial<Record<number, Answer>>;

/** Where the CTA block with the checklist form lives on the page. */
const CHECKLIST_ANCHOR = '#checklist';

const MOBILE_QUERY = '(max-width: 767px)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Bottom edge of the sticky site header, so scrolled-to content isn't hidden under it. */
function headerBottom(): number {
  return document.querySelector('.header')?.getBoundingClientRect().bottom ?? 0;
}

function scrollToElement(el: Element, smooth: boolean) {
  window.scrollTo({
    top: window.scrollY + el.getBoundingClientRect().top - headerBottom() - 16,
    behavior: smooth && !window.matchMedia(REDUCED_MOTION_QUERY).matches ? 'smooth' : 'auto',
  });
}

export default function SovereigntySelfCheck() {
  const [answers, setAnswers] = useState<Answers>({});
  const [showResult, setShowResult] = useState(false);
  const [copied, setCopied] = useState(false);
  const started = useRef(false);
  /** True when the last answer came from a tap or click, not the keyboard. */
  const pointerAnswer = useRef(false);
  /** Pending auto-scroll, cancelled when the result opens or the quiz restarts. */
  const scrollTimer = useRef<number | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const questionRefs = useRef(new Map<number, HTMLFieldSetElement>());
  const groupTitleRefs = useRef(new Map<number, HTMLHeadingElement>());

  const answered = QUESTIONS.filter((q) => answers[q.n]).length;
  const complete = answered === QUESTIONS.length;
  const points = score(answers);
  const resultBand = band(points);
  const gapLines = gaps(answers);

  useEffect(() => {
    if (showResult && resultRef.current) scrollToElement(resultRef.current, true);
  }, [showResult]);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(id);
  }, [copied]);

  /** Mobile only: after a first answer by tap, bring the next unanswered question into view. */
  function autoScroll(n: number, next: Answers) {
    if (!pointerAnswer.current || !window.matchMedia(MOBILE_QUERY).matches) return;
    const target = QUESTIONS.find((q) => q.n > n && !next[q.n]) ?? QUESTIONS.find((q) => !next[q.n]);
    if (!target) return;
    const el = questionRefs.current.get(target.n);
    if (!el) return;
    const bar = rootRef.current?.querySelector('.sc-bar')?.getBoundingClientRect().height ?? 0;
    const r = el.getBoundingClientRect();
    if (r.top >= headerBottom() && r.bottom <= window.innerHeight - bar) return;
    // First question of a group: keep the group heading in view too.
    const heading = groupTitleRefs.current.get(target.n);
    window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => {
      const to = heading ?? el;
      if (to.isConnected) scrollToElement(to, true);
    }, 300);
  }

  function choose(n: number, value: Answer) {
    const firstAnswer = !answers[n];
    const next = { ...answers, [n]: value };
    setAnswers(next);
    if (!started.current) {
      started.current = true;
      trackEvent('self-check-start');
    }
    if (firstAnswer) autoScroll(n, next);
  }

  function seeResult() {
    if (!complete) return;
    window.clearTimeout(scrollTimer.current);
    setShowResult(true);
    trackEvent('self-check-complete', { score: points, band: resultBand });
  }

  function startAgain() {
    window.clearTimeout(scrollTimer.current);
    setAnswers({});
    setShowResult(false);
    setCopied(false);
    window.requestAnimationFrame(() => {
      if (rootRef.current) scrollToElement(rootRef.current, false);
    });
  }

  async function copyResults() {
    const text = resultText(answers, window.location.origin + window.location.pathname);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older browsers or a denied permission: fall back to a hidden textarea.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    trackEvent('self-check-copy');
  }

  return (
    <div className="sc" ref={rootRef}>
      <div role="status" aria-live="polite" className="sc-live">
        {showResult ? `${points} of 10 under your control. ${BANDS[resultBand].headline}.` : ''}
      </div>

      {showResult ? (
        <div className="sc-result" ref={resultRef}>
          <p className="sc-result__score">
            <strong>{points} of 10</strong> under your control
          </p>
          <div className="sc-meter" aria-hidden="true">
            {QUESTIONS.map((q, i) => (
              <span key={q.n} className={i < points ? 'sc-meter__seg sc-meter__seg--on' : 'sc-meter__seg'} />
            ))}
          </div>
          <h2 className="sc-result__headline">{BANDS[resultBand].headline}</h2>
          {gapLines.length > 0 ? (
            <>
              <p className="sc-result__text">{BANDS[resultBand].text}</p>
              <h3 className="sc-gaps__title">Your gaps</h3>
              <ul className="sc-gaps" role="list">
                {gapLines.map(({ question, answer }) => (
                  <li key={question.n} className="sc-gap">
                    <span className={`sc-tag sc-tag--${answer}`}>{GAP_LABEL[answer]}:</span>
                    <div>
                      <p className="sc-gap__text">{question.gap}</p>
                      <a className="sc-gap__link" href={CHECKLIST_ANCHOR}>
                        {pointerText(question.checklistQ)} →
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="sc-nogaps">{NO_GAPS}</p>
          )}
          <div className="sc-result__actions">
            <button type="button" className="sc-copy" onClick={copyResults}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              {copied ? 'Copied' : 'Copy results'}
            </button>
            <button type="button" className="sc-restart" onClick={startAgain}>
              Start again
            </button>
          </div>
        </div>
      ) : (
        <form
          className="sc-quiz"
          onSubmit={(e) => {
            e.preventDefault();
            seeResult();
          }}
        >
          {GROUPS.map((group, gi) => (
            <div className="sc-group" key={group.name}>
              <h2
                className="sc-group__title"
                ref={(el) => {
                  if (el) groupTitleRefs.current.set(group.questions[0].n, el);
                }}
              >
                <span className="sc-group__num" aria-hidden="true">
                  {gi + 1}
                </span>
                {group.name}
              </h2>
              {group.questions.map((q) => (
                <fieldset
                  key={q.n}
                  className={answers[q.n] ? 'sc-q sc-q--done' : 'sc-q'}
                  ref={(el) => {
                    if (el) questionRefs.current.set(q.n, el);
                  }}
                >
                  <legend className="sc-q__legend">
                    <span className="sc-q__n">{q.n}.</span>
                    {q.question}
                  </legend>
                  <div className="sc-q__opts">
                    {ANSWER_OPTIONS.map((opt) => (
                      <label
                        key={opt.value}
                        className={answers[q.n] === opt.value ? 'sc-opt sc-opt--on' : 'sc-opt'}
                        onPointerDown={() => {
                          pointerAnswer.current = true;
                        }}
                      >
                        <input
                          type="radio"
                          name={`q${q.n}`}
                          value={opt.value}
                          checked={answers[q.n] === opt.value}
                          onKeyDown={() => {
                            pointerAnswer.current = false;
                          }}
                          onChange={() => choose(q.n, opt.value)}
                        />
                        <span>{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
          ))}

          <div className="sc-bar">
            <div className="sc-bar__progress">
              <span className="sc-bar__label">{answered} of 10 answered</span>
              <span className="sc-bar__track" aria-hidden="true">
                <span className="sc-bar__fill" style={{ width: `${answered * 10}%` }} />
              </span>
            </div>
            <button type="submit" className="ds-btn ds-btn-primary sc-bar__btn" disabled={!complete}>
              See my result
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
