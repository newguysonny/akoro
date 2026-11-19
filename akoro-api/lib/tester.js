/** A seeded test learner: username tester01–tester99 AND a @demo.akoro.app email. */
export const isTester = (u) => /^tester\d{2}$/i.test(String(u?.username || "")) && /@demo\.akoro\.app$/i.test(String(u?.email || ""));
