/**
 * pages.js — every public (indexable) page of the marketing site: its title, description, H1, a short text summary
 * and the links a crawler should follow. The build script turns each into real HTML (so crawlers and link previews
 * that don't run JavaScript see it); RouteMeta applies the same title/description while a visitor navigates.
 *
 * `sections` pages (ai-protege, how-it-works, exam-prep) have no other source: ContentPage.jsx renders them from here,
 * so the words a crawler reads and the words a person reads are the same words.
 */
import { TITLE, DESCRIPTION, ENTITY, CONCEPT, DIFFERENCE } from './site.js';

export const PAGES = [
  {
    path: '/', title: TITLE, description: DESCRIPTION, h1: TITLE, type: 'WebPage',
    lead: [ENTITY, CONCEPT, DIFFERENCE],
    links: [
      ['Learn about AI proteges', '/ai-protege'], ['How Akoro works', '/how-it-works'], ['Akoro for students', '/for-students'],
      ['Akoro for teachers', '/for-teachers'], ['Akoro for schools', '/for-schools'], ['Exam preparation with Akoro', '/exam-prep'],
      ['Pricing', '/pricing'], ['Read the Akoro blog', '/blog'],
    ],
  },
  {
    path: '/about', title: 'About Akoro', h1: 'About Akoro', type: 'AboutPage',
    description: 'Akoro is an education and learning platform built around AI proteges, made in Lagos, Nigeria. Who we are, why we exist and how to reach us.',
    lead: [ENTITY, 'Akoro is built in Lagos, Nigeria, around the protege effect: students learn deeply by teaching, so every Akoro session puts the student in the role of teacher.'],
    links: [['AI proteges', '/ai-protege'], ['How Akoro works', '/how-it-works'], ['Contact Akoro', '/contact'], ['Careers at Akoro', '/careers']],
  },
  {
    path: '/ai-protege', title: 'AI Proteges: a new way to learn | Akoro', h1: 'AI proteges: a new way to learn', type: 'WebPage',
    description: 'An AI protege is a personal AI learner that a student teaches, practises with and develops over time. Teaching it is how the student learns.',
    parent: '/', term: 'AI protege',
    lead: [CONCEPT, DIFFERENCE],
    sections: [
      { h2: 'What is an AI protege?', p: [
        CONCEPT,
        'The word comes from the protégé effect, a finding in learning research: people learn more when they teach someone else. An AI protege gives every student someone to teach, at any hour, on any topic they are studying. (Both spellings, protege and protégé, mean the same thing here.)'] },
      { h2: 'The learning loop', p: ['Every Akoro session follows the same loop, and each step makes the student think harder than reading or watching would:'],
        list: ['Teach: explain a topic to your AI protege in your own words.', 'It answers: your protege responds, asks questions and sometimes gets things wrong.', 'You correct: finding and fixing its mistakes shows you what you really understand.', 'Practise: questions, quizzes and battles on the same topic.', 'Feedback: Akoro shows what you know, what is shaky and what to do next.'] },
      { h2: 'AI tutor or AI protege?', p: ['An AI tutor explains things to you. An AI protege reverses the roles.'],
        list: ['AI tutor: the AI talks and the student listens. The student can feel they understand without being tested.', 'AI protege: the student talks and the AI listens, asks and tests. Gaps show up because the student has to explain them.', 'Akoro uses both: your protege to learn by teaching, and guidance to teach you back when you get stuck.'] },
      { h2: 'Why teaching works', p: [
        'Learning by teaching is among the better-studied ideas in education research. Chase and colleagues (2009) found that students put more effort into learning for a teachable agent than for themselves, which they called the protégé effect. Nestojko and colleagues (2014) found that simply expecting to teach improves how well people organise and remember material. Fiorella and Mayer (2013) found that actually teaching a lesson gave students further gains.',
        'Akoro builds those findings into the product: the student always has someone to teach.'] },
      { h2: 'Where to go next', p: ['See the loop in the product on How Akoro works, or read how it fits your role: students, teachers or schools.'] },
    ],
    links: [['How Akoro works', '/how-it-works'], ['Akoro for students', '/for-students'], ['Akoro for teachers', '/for-teachers'], ['Akoro for schools', '/for-schools']],
  },
  {
    path: '/how-it-works', title: 'How Akoro Works | Akoro', h1: 'How Akoro works', type: 'WebPage',
    description: 'Teach your AI protege, chat, prepare with Study Prep, compete in battles and get feedback. How a student learns on Akoro, step by step.',
    parent: '/',
    lead: ['Akoro turns studying into teaching. Here is the loop, as it appears in the product.'],
    sections: [
      { h2: 'Teach your AI protege', p: ['Pick a topic and explain it to your protege in your own words. It answers back, asks questions and shows you what is still unclear. This is where the learning happens.'] },
      { h2: 'Chat and ask', p: ['Stuck? Talk to your AI agent in chat. Ask for an explanation, an example or a different angle, then go back and teach it again.'] },
      { h2: 'Study Prep', p: ['Study Prep turns your topics and materials into a plan with questions, flashcards, summaries and quizzes, so practice follows what you have just taught.'] },
      { h2: 'Battles', p: ['Test what you know against friends and classmates. A battle is practice that feels like a game.'] },
      { h2: 'Agent Check', p: ['In Agent Check, Akoro asks questions and your AI protege answers using only what you have taught it. The answers are scored, so you see how well you taught it and what to teach again.'] },
      { h2: 'Feedback', p: ['After each session Akoro shows what went well, what is shaky and what to do next. Teachers and schools see the same progress for their classes.'] },
    ],
    links: [['What is an AI protege?', '/ai-protege'], ['Akoro for students', '/for-students'], ['Exam preparation with Akoro', '/exam-prep'], ['Pricing', '/pricing']],
  },
  {
    path: '/for-students', title: 'Akoro for Students: learn by teaching AI | Akoro', h1: 'Akoro for students', type: 'WebPage',
    description: 'Learn by teaching an AI protege, then practise and get feedback. Akoro for students: study smarter for school and exams.',
    parent: '/', legacy: ['/student-info'],
    lead: ['Teach your AI protege, practise on what you taught and get feedback on what to fix. Akoro helps students learn by teaching.'],
    links: [['What is an AI protege?', '/ai-protege'], ['How Akoro works', '/how-it-works'], ['Exam preparation with Akoro', '/exam-prep']],
  },
  {
    path: '/for-teachers', title: 'Akoro for Teachers | Akoro', h1: 'Akoro for teachers', type: 'WebPage',
    description: 'Create courses and assignments on Akoro and see how your students learn when they teach AI proteges. Akoro for teachers and instructors.',
    parent: '/', legacy: ['/instructor-info'],
    lead: ['Build courses and assignments, and see how your students understand a topic when they have to teach it. Akoro for teachers and instructors.'],
    links: [['What is an AI protege?', '/ai-protege'], ['How Akoro works', '/how-it-works'], ['Akoro for schools', '/for-schools']],
  },
  {
    path: '/for-schools', title: 'Akoro for Schools | Akoro', h1: 'Akoro for schools', type: 'WebPage',
    description: 'A school website, an AI assistant and school operations in one place, with AI protege learning for students. Akoro for schools.',
    parent: '/', legacy: ['/school-info'],
    lead: ['Give your school a website, an AI assistant and a learning platform built around AI proteges.'],
    links: [['Pricing', '/pricing'], ['Why Akoro', '/compare'], ['Bring Akoro to your school', '/apply'], ['Contact Akoro', '/contact']],
  },
  {
    path: '/exam-prep', title: 'Exam Preparation with Akoro | WAEC, NECO, JAMB', h1: 'Exam preparation with Akoro', type: 'WebPage',
    description: 'Prepare for WAEC, NECO and JAMB by teaching an AI protege: syllabus topics, practice questions and feedback on what to revise.',
    parent: '/',
    lead: ['Prepare for WAEC, NECO and JAMB by teaching what you are revising to your AI protege.'],
    sections: [
      { h2: 'Start from the syllabus', p: ['Akoro organises revision by subject and topic, so you always know what you are covering and what is left.'] },
      { h2: 'Teach each topic', p: ['Explain a topic to your protege before you practise it. If you cannot explain it, you have found something to revise.'] },
      { h2: 'Practise and get feedback', p: ['Work through practice questions on the topics you taught, then see which ones are strong and which need another pass.'] },
      { h2: 'Revise what is weak', p: ['Akoro points you back to the shaky topics, so the days before an exam go on the right things.'] },
    ],
    links: [['What is an AI protege?', '/ai-protege'], ['How Akoro works', '/how-it-works'], ['Akoro for students', '/for-students'], ['Pricing', '/pricing']],
  },
  { path: '/pricing', title: 'Pricing | Akoro', h1: 'Your school’s website, AI assistant & operations, in one price.', type: 'WebPage', parent: '/',
    description: 'Akoro pricing for students and schools: one price for the school website, the AI assistant and operations.',
    lead: ['Akoro pricing for students and schools.'], links: [['Akoro for schools', '/for-schools'], ['Why Akoro', '/compare'], ['Contact Akoro', '/contact']] },
  { path: '/compare', title: 'Why Akoro | Akoro', h1: 'Not a website. Not an app. Your school’s whole online presence, with a brain.', type: 'WebPage', parent: '/',
    description: 'How Akoro compares with a school website or a learning app: one platform for your school’s whole online presence.',
    lead: ['How Akoro compares with a school website or a learning app.'], links: [['Pricing', '/pricing'], ['Akoro for schools', '/for-schools']] },
  { path: '/partners', title: 'Partners | Akoro', h1: 'Grow further, together', type: 'WebPage', parent: '/',
    description: 'Partner with Akoro: schools, publishers and organisations working with us to improve how students learn.',
    lead: ['Partner with Akoro to improve how students learn.'], links: [['Contact Akoro', '/contact'], ['About Akoro', '/about']] },
  { path: '/blog', title: 'Blog | Akoro', h1: 'Insights on learning, education & AI', type: 'CollectionPage', parent: '/',
    description: 'Research-backed thinking on how people learn, how schools evolve and how AI is changing education, from the Akoro team.',
    lead: ['Research-backed thinking on how people learn, how schools evolve and how AI is changing education.'], links: [['What is an AI protege?', '/ai-protege']] },
  { path: '/contact', title: 'Contact Akoro', h1: 'Get in touch', type: 'ContactPage', parent: '/',
    description: 'Contact the Akoro team: questions about AI proteges, schools, partnerships or support.',
    lead: ['Contact the Akoro team.'], links: [['About Akoro', '/about'], ['Careers at Akoro', '/careers']] },
  { path: '/careers', title: 'Careers | Akoro', h1: 'Help us make learning actually stick — for every student in Africa', type: 'WebPage', parent: '/',
    description: 'Work at Akoro: open roles in engineering, product, AI research and school partnerships.',
    lead: ['Open roles at Akoro.'], links: [['About Akoro', '/about'], ['Contact Akoro', '/contact']] },
  { path: '/apply', title: 'Bring Akoro to your school | Akoro', h1: 'Bring Akoro to your school', type: 'WebPage', parent: '/for-schools',
    description: 'Apply to bring Akoro to your school: tell us about your school and we will be in touch about a pilot.',
    lead: ['Apply to bring Akoro to your school.'], links: [['Akoro for schools', '/for-schools'], ['Pricing', '/pricing']] },
  { path: '/privacy', title: 'Privacy Policy | Akoro', h1: 'Your Privacy Matters', type: 'WebPage', parent: '/',
    description: 'How Akoro collects, uses and protects personal data, including students’ data.',
    lead: ['How Akoro collects, uses and protects personal data.'], links: [['Terms of Service', '/terms']] },
  { path: '/terms', title: 'Terms of Service | Akoro', h1: 'Terms of Service', type: 'WebPage', parent: '/',
    description: 'The terms for using Akoro.',
    lead: ['The terms for using Akoro.'], links: [['Privacy Policy', '/privacy']] },
];

export const pageFor = (pathname) => PAGES.find((p) => p.path === String(pathname).replace(/(.)\/+$/, '$1')) || null;

/** Old address → new address (301 in vercel.json; the app forwards them too). */
export const LEGACY = PAGES.flatMap((p) => (p.legacy || []).map((from) => [from, p.path]));
