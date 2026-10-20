/**
 * lib/embeddingEvalSet.js — a fixed test set for choosing an embedding model
 * (2026-10-20): short passages like a learner's notes and Library chunks, and
 * the questions a learner would ask that should find each one. Passages come
 * in close groups (osmosis / diffusion / active transport, …) so a model has
 * to tell near neighbours apart, not just subjects. A few questions are in
 * Nigerian Pidgin, as learners write them in chat.
 *
 * Fixed on purpose: the same set every run, so two models (or two runs of
 * one) compare like for like. lib/embeddingCompare.js scores it.
 *
 *   PASSAGES  [{ id, subject, text }]
 *   QUERIES   [{ q, answer: passage id, lang: "en" | "pcm" }]
 */
export const PASSAGES = Object.freeze([
  // Biology — cell transport
  { id: "bio-osmosis", subject: "Biology", text: "Osmosis is the movement of water molecules from a region of higher water concentration to a region of lower water concentration through a selectively permeable membrane. Plant cells placed in pure water become turgid." },
  { id: "bio-diffusion", subject: "Biology", text: "Diffusion is the movement of molecules of a substance from a region of higher concentration to a region of lower concentration until they are evenly spread. It needs no energy and no membrane, as when the smell of perfume spreads across a room." },
  { id: "bio-active", subject: "Biology", text: "Active transport moves ions such as potassium into a cell against their concentration gradient. It uses energy from respiration (ATP) and carrier proteins in the cell membrane, which is how root hairs take up mineral salts from the soil." },
  { id: "bio-plasmolysis", subject: "Biology", text: "When a plant cell is placed in a concentrated salt solution it loses water by osmosis; the cytoplasm shrinks away from the cell wall. This is plasmolysis, and a plasmolysed cell is flaccid." },
  // Biology — energy, nutrition
  { id: "bio-respiration", subject: "Biology", text: "Aerobic respiration takes place in the mitochondria. Glucose is broken down with oxygen to release energy, producing carbon dioxide and water: C6H12O6 + 6O2 → 6CO2 + 6H2O + energy." },
  { id: "bio-anaerobic", subject: "Biology", text: "Anaerobic respiration releases energy from glucose without oxygen. In yeast it produces ethanol and carbon dioxide (fermentation, used in brewing and baking); in muscles it produces lactic acid and causes cramp." },
  { id: "bio-photosynthesis", subject: "Biology", text: "Photosynthesis takes place in the chloroplasts of green leaves. Chlorophyll absorbs light energy, which is used to make glucose from carbon dioxide and water, and oxygen is given off as a by-product." },
  { id: "bio-malaria", subject: "Biology", text: "Malaria is caused by the parasite Plasmodium and spread by the bite of the female Anopheles mosquito. It can be prevented by sleeping under treated nets and clearing stagnant water where mosquitoes breed." },
  // Chemistry
  { id: "chem-ionic", subject: "Chemistry", text: "An ionic bond forms when a metal atom transfers electrons to a non-metal atom, making oppositely charged ions that attract. Sodium chloride is ionic: it has a high melting point and conducts electricity when molten or dissolved." },
  { id: "chem-covalent", subject: "Chemistry", text: "A covalent bond forms when two non-metal atoms share a pair of electrons. Simple covalent substances such as water and methane have low melting and boiling points and do not conduct electricity." },
  { id: "chem-electrolysis", subject: "Chemistry", text: "In electrolysis an electric current decomposes an electrolyte. Positive ions move to the cathode and are reduced; negative ions move to the anode and are oxidised. Electrolysis of brine gives chlorine, hydrogen and sodium hydroxide." },
  { id: "chem-rates", subject: "Chemistry", text: "The rate of a reaction increases with temperature, concentration, surface area and a catalyst. Powdered marble reacts with hydrochloric acid faster than marble chips because more surface is exposed to the acid." },
  { id: "chem-acids", subject: "Chemistry", text: "An acid reacts with a base to form a salt and water; this is neutralisation. Acids have a pH below 7 and turn blue litmus red. Farmers add lime to acidic soil to neutralise it." },
  { id: "chem-crude", subject: "Chemistry", text: "Crude oil is separated into fractions such as petrol, kerosene and diesel by fractional distillation, because the fractions have different boiling points. Nigeria's refineries at Port Harcourt, Warri and Kaduna use this process." },
  // Physics
  { id: "phy-ohm", subject: "Physics", text: "Ohm's law states that the current through a conductor is directly proportional to the potential difference across it, provided temperature stays constant: V = IR, where R is the resistance in ohms." },
  { id: "phy-series", subject: "Physics", text: "In a series circuit the same current flows through every component and the total resistance is the sum of the resistances. If one bulb blows, all the bulbs go out." },
  { id: "phy-newton2", subject: "Physics", text: "Newton's second law: the rate of change of momentum is proportional to the applied force, so F = ma. A force of 10 N on a 2 kg mass gives an acceleration of 5 m/s²." },
  { id: "phy-refraction", subject: "Physics", text: "Refraction is the bending of light as it passes from one medium into another of different optical density. A stick in water looks bent, and Snell's law relates the angles: n = sin i / sin r." },
  // Mathematics
  { id: "math-quadratic", subject: "Mathematics", text: "A quadratic equation ax² + bx + c = 0 can be solved with the formula x = (−b ± √(b² − 4ac)) / 2a. The discriminant b² − 4ac tells you whether the roots are real and distinct, equal, or not real." },
  { id: "math-simultaneous", subject: "Mathematics", text: "Simultaneous linear equations in two unknowns can be solved by elimination or substitution. For 2x + y = 7 and x − y = 2, adding the equations gives 3x = 9, so x = 3 and y = 1." },
  { id: "math-pythagoras", subject: "Mathematics", text: "Pythagoras' theorem: in a right-angled triangle the square on the hypotenuse equals the sum of the squares on the other two sides, a² + b² = c². A triangle with sides 3, 4 and 5 is right-angled." },
  { id: "math-probability", subject: "Mathematics", text: "The probability of an event is the number of favourable outcomes divided by the total number of equally likely outcomes. The probability of getting a 6 when a fair die is thrown is 1/6." },
  { id: "math-sine", subject: "Mathematics", text: "The sine rule a/sin A = b/sin B = c/sin C is used to find sides and angles of any triangle when you know a side and its opposite angle. The cosine rule is used when two sides and the included angle are known." },
  // English
  { id: "eng-concord", subject: "English", text: "Concord is agreement between the subject and the verb. A singular subject takes a singular verb: 'The list of names is on the table', not 'are', because the subject is 'list'." },
  { id: "eng-summary", subject: "English", text: "In a summary question, answer in your own words, in complete sentences, and keep to the number of points asked for. Do not copy whole sentences from the passage or add your own opinion." },
  { id: "eng-letter", subject: "English", text: "A formal letter has the writer's address, the date, the recipient's address, a salutation such as 'Dear Sir', a heading, the body and a formal close such as 'Yours faithfully' followed by the full name." },
  // Economics, Government, Geography
  { id: "econ-demand", subject: "Economics", text: "The law of demand states that, other things being equal, the higher the price of a commodity the lower the quantity demanded, and the lower the price the higher the quantity demanded. The demand curve slopes downward." },
  { id: "econ-inflation", subject: "Economics", text: "Inflation is a persistent rise in the general price level, which reduces the purchasing power of money. Causes include excess money supply (demand-pull) and rising costs of production (cost-push)." },
  { id: "gov-separation", subject: "Government", text: "Separation of powers divides government into the legislature, which makes laws, the executive, which carries them out, and the judiciary, which interprets them, so that no one arm holds all the power." },
  { id: "geo-harmattan", subject: "Geography", text: "The harmattan is a dry, dusty north-east trade wind that blows from the Sahara across West Africa between November and March, bringing cold mornings, haze and low humidity." },
]);

export const QUERIES = Object.freeze([
  { q: "Why do plant cells become turgid in pure water?", answer: "bio-osmosis", lang: "en" },
  { q: "Movement of water across a partially permeable membrane", answer: "bio-osmosis", lang: "en" },
  { q: "How does the smell of perfume spread in a room?", answer: "bio-diffusion", lang: "en" },
  { q: "Does diffusion need energy?", answer: "bio-diffusion", lang: "en" },
  { q: "How do root hairs absorb minerals against a concentration gradient?", answer: "bio-active", lang: "en" },
  { q: "Which transport process uses ATP and carrier proteins?", answer: "bio-active", lang: "en" },
  { q: "What happens to a plant cell in salt solution?", answer: "bio-plasmolysis", lang: "en" },
  { q: "Where in the cell is energy released with oxygen?", answer: "bio-respiration", lang: "en" },
  { q: "Equation for aerobic respiration", answer: "bio-respiration", lang: "en" },
  { q: "Why do my muscles cramp after running?", answer: "bio-anaerobic", lang: "en" },
  { q: "How does yeast make bread rise?", answer: "bio-anaerobic", lang: "en" },
  { q: "What does chlorophyll do in a leaf?", answer: "bio-photosynthesis", lang: "en" },
  { q: "Raw materials and products of photosynthesis", answer: "bio-photosynthesis", lang: "en" },
  { q: "Which mosquito carries malaria and how can we prevent it?", answer: "bio-malaria", lang: "en" },
  { q: "Why does sodium chloride conduct electricity when molten?", answer: "chem-ionic", lang: "en" },
  { q: "Transfer of electrons from a metal to a non-metal", answer: "chem-ionic", lang: "en" },
  { q: "Why does water have a low boiling point compared with salt?", answer: "chem-covalent", lang: "en" },
  { q: "Sharing of electron pairs between atoms", answer: "chem-covalent", lang: "en" },
  { q: "What is produced at the cathode and anode when brine is electrolysed?", answer: "chem-electrolysis", lang: "en" },
  { q: "Why does powdered marble react faster than chips?", answer: "chem-rates", lang: "en" },
  { q: "Factors that affect how fast a reaction goes", answer: "chem-rates", lang: "en" },
  { q: "Why do farmers put lime on their soil?", answer: "chem-acids", lang: "en" },
  { q: "What is neutralisation?", answer: "chem-acids", lang: "en" },
  { q: "How is kerosene separated from crude oil?", answer: "chem-crude", lang: "en" },
  { q: "Relationship between voltage, current and resistance", answer: "phy-ohm", lang: "en" },
  { q: "Why do all the bulbs go off when one blows?", answer: "phy-series", lang: "en" },
  { q: "Total resistance of resistors connected one after another", answer: "phy-series", lang: "en" },
  { q: "Calculate acceleration when a 10 N force acts on 2 kg", answer: "phy-newton2", lang: "en" },
  { q: "Force equals mass times acceleration", answer: "phy-newton2", lang: "en" },
  { q: "Why does a stick look bent in water?", answer: "phy-refraction", lang: "en" },
  { q: "How do I use the quadratic formula?", answer: "math-quadratic", lang: "en" },
  { q: "What does the discriminant tell me about the roots?", answer: "math-quadratic", lang: "en" },
  { q: "Solve 2x + y = 7 and x − y = 2", answer: "math-simultaneous", lang: "en" },
  { q: "Elimination method for two equations", answer: "math-simultaneous", lang: "en" },
  { q: "Is a triangle with sides 3, 4, 5 right-angled?", answer: "math-pythagoras", lang: "en" },
  { q: "Chance of throwing a six with a die", answer: "math-probability", lang: "en" },
  { q: "When do I use the sine rule instead of the cosine rule?", answer: "math-sine", lang: "en" },
  { q: "Is it 'the list of names is' or 'are'?", answer: "eng-concord", lang: "en" },
  { q: "Subject–verb agreement", answer: "eng-concord", lang: "en" },
  { q: "How to answer the summary question in the English paper", answer: "eng-summary", lang: "en" },
  { q: "How do I end a formal letter?", answer: "eng-letter", lang: "en" },
  { q: "Why does the demand curve slope downward?", answer: "econ-demand", lang: "en" },
  { q: "What is cost-push inflation?", answer: "econ-inflation", lang: "en" },
  { q: "Prices keep rising and money buys less", answer: "econ-inflation", lang: "en" },
  { q: "Legislature, executive and judiciary roles", answer: "gov-separation", lang: "en" },
  { q: "Dry dusty wind from the Sahara in December", answer: "geo-harmattan", lang: "en" },
  // Nigerian Pidgin, as learners type it in chat
  { q: "Wetin dey make water enter plant cell make e swell?", answer: "bio-osmosis", lang: "pcm" },
  { q: "Abeg explain how yeast take make bread rise", answer: "bio-anaerobic", lang: "pcm" },
  { q: "Na which mosquito dey carry malaria?", answer: "bio-malaria", lang: "pcm" },
  { q: "How I go take solve quadratic equation?", answer: "math-quadratic", lang: "pcm" },
  { q: "Why all the bulb go off when one spoil?", answer: "phy-series", lang: "pcm" },
  { q: "Why market price dey always go up?", answer: "econ-inflation", lang: "pcm" },
]);
