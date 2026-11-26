// Questions and result copy for /sovereignty-self-check/. Copy changes go
// here; the island only renders it. Source: draft 12 of the UK/EU campaign
// (handbook), taken from the sovereign login checklist.

export type Answer = 'yes' | 'no' | 'unsure';
export type Band = 'high' | 'mid' | 'low';

export interface Question {
  n: number;
  question: string;
  /** Shown in the gap list when the answer isn't "yes". */
  gap: string;
  /** Checklist question the gap line points to (the first one, if several). */
  checklistQ: number;
}

export interface Group {
  name: string;
  questions: Question[];
}

export const GROUPS: Group[] = [
  {
    name: 'Where the data sits',
    questions: [
      {
        n: 1,
        question:
          'Do you know which countries your login database, backups and disaster-recovery copies are in?',
        gap: 'Where the database, backups and recovery copies are stored, by country. Backups are full copies of everything.',
        checklistQ: 1,
      },
      {
        n: 2,
        question: 'Do login logs, audit logs and monitoring data stay in those same countries?',
        gap: "Where logs and monitoring data go. They're often shipped to another country even when the database isn't.",
        checklistQ: 2,
      },
      {
        n: 3,
        question:
          'Is the hosting region fixed in your contract, or under your control because you run it yourself?',
        gap: 'Whether the region is fixed in writing, with notice before anything moves.',
        checklistQ: 3,
      },
    ],
  },
  {
    name: 'Who operates it',
    questions: [
      {
        n: 4,
        question:
          'Do you know who has admin access to the login servers and database, and which countries they work from?',
        gap: 'Who has admin access, and from which countries. Remote access from abroad can count as a transfer in its own right.',
        checklistQ: 5,
      },
      {
        n: 5,
        question: 'Can you see a record of when support or admin staff access your user data?',
        gap: 'Whether support and admin access to user data is logged, and whether you can see those logs.',
        checklistQ: 7,
      },
    ],
  },
  {
    name: 'Whose law applies',
    questions: [
      {
        n: 6,
        question:
          'Do you know which company runs your login system, where its parent company is based, and which foreign laws, such as the US CLOUD Act, apply to them?',
        gap: 'Which company you depend on, where its parent is, and which foreign laws reach them.',
        checklistQ: 9,
      },
    ],
  },
  {
    name: 'Can you leave',
    questions: [
      {
        n: 7,
        question:
          'Could you export all your users, including password hashes and MFA enrolments, without making them reset?',
        gap: 'Whether you can take your users with you, password hashes and MFA included.',
        checklistQ: 13,
      },
      {
        n: 8,
        question:
          'Do your apps connect to login through open standards, such as OpenID Connect or SAML, rather than a vendor-only SDK?',
        gap: "Whether your apps depend on one vendor's SDK. Open standards make moving easier.",
        checklistQ: 15,
      },
      {
        n: 9,
        question: 'Could you run the same login software yourself if you had to?',
        gap: 'Whether the software could run without the vendor, under a licence that allows it.',
        checklistQ: 16,
      },
    ],
  },
  {
    name: 'Who else touches it',
    questions: [
      {
        n: 10,
        question:
          "Do you know which email, SMS and WhatsApp providers send your one-time codes, and where they're based?",
        gap: "Which providers see your users' phone numbers, email addresses and one-time codes, and where they are.",
        checklistQ: 17,
      },
    ],
  },
];

export const QUESTIONS: Question[] = GROUPS.flatMap((g) => g.questions);

export const ANSWER_OPTIONS: { value: Answer; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unsure', label: 'Not sure' },
];

export const BANDS: Record<Band, { headline: string; text: string }> = {
  high: {
    headline: 'You know where your login data goes',
    text: 'You can answer most of the questions a customer or regulator would ask. Check the gaps below, then use the full checklist for vendor reviews.',
  },
  mid: {
    headline: 'Some of your login data is out of view',
    text: "You know the basics, but parts of the setup, often logs, backups or message providers, aren't clear yet. The gaps below are where to start.",
  },
  low: {
    headline: 'Most of your login setup is out of view',
    text: "That's common when login was set up by a vendor years ago. The gaps below are the questions to ask them first.",
  },
};

export const NO_GAPS =
  'No gaps on these ten. The full checklist has ten more questions, including sub-processors and government requests.';

export const GAP_LABEL: Record<Exclude<Answer, 'yes'>, string> = {
  no: 'Gap',
  unsure: 'Find out',
};

export const pointerText = (checklistQ: number) =>
  `What a good vendor answer looks like: checklist question ${checklistQ}`;

/** Yes = 1 point; No and Not sure = 0. */
export function score(answers: Partial<Record<number, Answer>>): number {
  return QUESTIONS.filter((q) => answers[q.n] === 'yes').length;
}

/** 8–10 high, 5–7 mid, 0–4 low. */
export function band(points: number): Band {
  if (points >= 8) return 'high';
  if (points >= 5) return 'mid';
  return 'low';
}

/** Gap lines in question order: every question answered No or Not sure. */
export function gaps(answers: Partial<Record<number, Answer>>) {
  return QUESTIONS.flatMap((q) => {
    const a = answers[q.n];
    return a === 'no' || a === 'unsure' ? [{ question: q, answer: a }] : [];
  });
}

/** Plain-text summary for "Copy results". */
export function resultText(answers: Partial<Record<number, Answer>>, pageUrl: string): string {
  const points = score(answers);
  const b = BANDS[band(points)];
  const lines = gaps(answers).map(
    ({ question, answer }) =>
      `- ${GAP_LABEL[answer]}: ${question.gap} (checklist question ${question.checklistQ})`,
  );
  return [
    `Login data sovereignty self-check: ${points} of 10 under our control`,
    b.headline,
    '',
    ...(lines.length ? lines : [NO_GAPS]),
    '',
    `Take the self-check: ${pageUrl}`,
  ].join('\n');
}
