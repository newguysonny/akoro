/**
 * data/mockSeed.js
 * All mock / seed data extracted from ELearnPage.jsx.
 * Import only what you need.
 */

/* ══ SESSIONS ═══════════════════════════════════════════════════════════════ */
export const SESSIONS = [
  { id:"SES-001",subject:"maths",  type:"live",  scheduleBucket:"live",          title:"Algebra Fundamentals",   topic:"Solving Linear Equations",       description:"Master single and multi-step equations with variables on both sides. Includes worked examples and practice sets.",                                    tutor:"Ms. Rivera",avatar:"https://i.pravatar.cc/150?img=47",duration:"45 min",level:"Grade 8", xp:120,progress:68,priority:"live",    unread:3,resources:14,students:24,nextSession:"LIVE",            time:"9:00 AM", topics:6,revisions:4,reviews:7 },
  { id:"SES-002",subject:"english",type:"live",  scheduleBucket:"today",         title:"Creative Writing",        topic:"Narrative Voice & POV",          description:"Explore first, second, and third-person perspective through short story exercises and peer critique.",                                              tutor:"Mr. Chen",  avatar:"https://i.pravatar.cc/150?img=33",duration:"60 min",level:"Grade 9", xp:95, progress:42,priority:"upcoming",unread:1,resources:8, students:18,nextSession:"3:00 PM",         time:"3:00 PM", topics:4,revisions:2,reviews:3 },
  { id:"SES-003",subject:"science",type:"agent", scheduleBucket:"later",         title:"Cell Biology",            topic:"Mitosis & Meiosis",              description:"Compare and contrast cell division with animated diagrams, lab activities, and quiz checkpoints.",                                                  tutor:"AI Agent",  avatar:"https://i.pravatar.cc/150?img=52",duration:"50 min",level:"Grade 10",xp:140,progress:15,priority:"normal", unread:0,resources:21,students:31,nextSession:"Tomorrow 9:00 AM",time:"9:00 AM", topics:8,revisions:1,reviews:5 },
  { id:"SES-004",subject:"maths",  type:"live",  scheduleBucket:"week",          title:"Geometry & Proofs",       topic:"Triangle Congruence",            description:"SSS, SAS, ASA, AAS congruence theorems with construction exercises. Two-column proof practice.",                                                    tutor:"Ms. Rivera",avatar:"https://i.pravatar.cc/150?img=47",duration:"55 min",level:"Grade 9", xp:110,progress:0, priority:"normal", unread:0,resources:17,students:22,nextSession:"Wed 10:00 AM",   time:"10:00 AM",topics:5,revisions:0,reviews:2 },
  { id:"SES-005",subject:"english",type:"agent", scheduleBucket:"later",         title:"Literature Analysis",     topic:"Themes in To Kill a Mockingbird",description:"Deep-dive analysis of justice, race, and coming-of-age themes. Essay structure and textual evidence workshop.",                                  tutor:"AI Agent",  avatar:"https://i.pravatar.cc/150?img=44",duration:"60 min",level:"Grade 10",xp:130,progress:88,priority:"normal", unread:2,resources:11,students:27,nextSession:"Thu 1:30 PM",   time:"1:30 PM", topics:7,revisions:4,reviews:9 },
  { id:"SES-006",subject:"science",type:"agent", scheduleBucket:"later",         title:"Physics: Motion",         topic:"Newton's Laws & Forces",         description:"Hands-on simulation of inertia, acceleration, and action-reaction pairs. Problem set with real-world applications.",                               tutor:"AI Agent",  avatar:"https://i.pravatar.cc/150?img=52",duration:"45 min",level:"Grade 11",xp:155,progress:55,priority:"normal", unread:0,resources:19,students:29,nextSession:"Fri 2:00 PM",   time:"2:00 PM", topics:5,revisions:3,reviews:6 },
  // Starting soon — within 15 minutes
  { id:"SES-007",subject:"science",type:"live",  scheduleBucket:"starting-soon", minutesUntil:8,  title:"Biology: Ecosystems",     topic:"Food Chains & Energy Flow",      description:"Explore producer-consumer relationships and energy transfer across trophic levels.",                                                             tutor:"Dr. Adeyemi",avatar:"https://i.pravatar.cc/150?img=56",duration:"50 min",level:"Grade 9", xp:115,progress:0, priority:"upcoming",unread:0,resources:12,students:20,nextSession:"in 8 min",       time:"Now",     topics:4,revisions:0,reviews:0 },
  { id:"SES-008",subject:"maths",  type:"live",  scheduleBucket:"starting-soon", minutesUntil:14, title:"Further Maths",           topic:"Integration Techniques",         description:"Substitution, integration by parts and partial fractions with worked A-level examples.",                                                           tutor:"Mr. Okafor", avatar:"https://i.pravatar.cc/150?img=61",duration:"60 min",level:"Grade 11",xp:145,progress:0, priority:"upcoming",unread:0,resources:8, students:15,nextSession:"in 14 min",      time:"Now",     topics:5,revisions:0,reviews:0 },
  // Tomorrow
  { id:"SES-009",subject:"english",type:"live",  scheduleBucket:"tomorrow",      title:"English Language Paper 1",topic:"Descriptive & Narrative Writing",description:"Timed practice on Q5 creative writing with model answer analysis and peer assessment.",                                                          tutor:"Mrs. Bello", avatar:"https://i.pravatar.cc/150?img=38",duration:"60 min",level:"Grade 10",xp:120,progress:0, priority:"normal", unread:0,resources:6, students:22,nextSession:"Tomorrow 10 AM", time:"10:00 AM",topics:3,revisions:0,reviews:0 },
];

/* ══ CHALLENGES ═════════════════════════════════════════════════════════════ */
export const CHALLENGES = [
  { id:"CHG-001",battleType:"immediate",challenger:"Jordan M.",  avatar:"https://i.pravatar.cc/150?img=12",subject:"maths",  title:"Speed Algebra Duel",    description:"10 linear equations. First to finish with 100% accuracy wins. Best of 3 rounds.",xpPrize:"+250 XP",timeLimit:"15 min",difficulty:"hard",  expiresIn:"8 min", badge:"Math Champ 🏆",rating:4.8,agentBName:"Axiom",agentBEmoji:"⚡",agentBBg:"#FFF4C8",agentBColor:"#D97706" },
  { id:"CHG-002",battleType:"immediate",challenger:"Priya K.",   avatar:"https://i.pravatar.cc/150?img=44",subject:"english",title:"Vocabulary Blitz",       description:"50 vocab words from the SAT prep list. Match definitions under the clock.",xpPrize:"+180 XP",timeLimit:"10 min",difficulty:"medium",expiresIn:"22 min",badge:"Word Wizard 📖",rating:4.6,agentBName:"Ada",agentBEmoji:"✨",agentBBg:"#E4D4F0",agentBColor:"#7C3AED" },
  { id:"CHG-003",battleType:"scheduled",challenger:"Marcus B.",  avatar:"https://i.pravatar.cc/150?img=57",subject:"science",title:"Periodic Table Sprint", description:"Name the element, symbol, and atomic number from 20 random prompts.",xpPrize:"+200 XP",timeLimit:"12 min",difficulty:"hard",  expiresIn:"45 min",badge:"Science Star 🔬",rating:4.7,scheduledFor:"Tomorrow · 4:00 PM",agentBName:"Kira",agentBEmoji:"💎",agentBBg:"#F8E8FF",agentBColor:"#9333EA" },
  { id:"CHG-004",battleType:"scheduled",challenger:"Aaliyah T.", avatar:"https://i.pravatar.cc/150?img=32",subject:"maths",  title:"Geometry Quick-Fire",   description:"Calculate area, perimeter, and angles from 15 shape prompts. No calculator.",xpPrize:"+160 XP",timeLimit:"8 min", difficulty:"medium",expiresIn:"1h 10m",badge:"Shape Solver 📐",rating:4.5,scheduledFor:"Sat · 10:00 AM",agentBName:"Sigma",agentBEmoji:"🔺",agentBBg:"#C8D8E8",agentBColor:"#2563EB" },
  { id:"CHG-005",battleType:"immediate",challenger:"Leon S.",    avatar:"https://i.pravatar.cc/150?img=68",subject:"science",title:"Newton's Laws Blitz",   description:"15 quick-fire questions on forces, motion, and acceleration. No pauses.",xpPrize:"+220 XP",timeLimit:"12 min",difficulty:"hard",  expiresIn:"3 min", badge:"Physics Pro ⚡",rating:4.9,agentBName:"Lyra",agentBEmoji:"🌙",agentBBg:"#F0E4C8",agentBColor:"#D97706" },
  { id:"CHG-006",battleType:"scheduled",challenger:"Devon R.",   avatar:"https://i.pravatar.cc/150?img=33",subject:"english",title:"Grammar Gauntlet",      description:"30 grammar questions — tense, punctuation, and sentence structure. Timed.",xpPrize:"+140 XP",timeLimit:"10 min",difficulty:"easy",  expiresIn:"2h 30m",badge:"Grammar Guru 📝",rating:4.4,scheduledFor:"Sun · 2:00 PM",agentBName:"Zeno",agentBEmoji:"🌀",agentBBg:"#D4EAD8",agentBColor:"#059669" },
  { id:"CHG-007",battleType:"classroom",challenger:"Dr. Amara (Teacher)",avatar:"https://i.pravatar.cc/150?img=47",subject:"maths",title:"Calculus Class Championship",description:"Teacher's agent Pythia challenges the entire class. All student agents compete simultaneously — highest score wins the XP pool.",xpPrize:"+500 XP",timeLimit:"20 min",difficulty:"hard",expiresIn:"30 min",badge:"Class Champ 🏆",rating:5.0,
    teacherAgent:{ id:"pythia",name:"Pythia",emoji:"🔮",owner:"Dr. Amara",bg:"#EDE8F8",color:"#7C3AED",isTeacher:true },
    participants:[
      { id:"nexus",name:"Nexus",  emoji:"🤖",owner:"You",         bg:"#FEF0E6",color:"#E8884A",isYou:true  },
      { id:"ada",  name:"Ada",   emoji:"✨",owner:"Ngozi",       bg:"#E4D4F0",color:"#7C3AED" },
      { id:"sigma",name:"Sigma", emoji:"🔺",owner:"Jordan M.",   bg:"#C8D8E8",color:"#2563EB" },
      { id:"zeno", name:"Zeno",  emoji:"🌀",owner:"Chukwuemeka", bg:"#D4EAD8",color:"#059669" },
      { id:"lyra", name:"Lyra",  emoji:"🌙",owner:"Amaka",       bg:"#F0E4C8",color:"#D97706" },
      { id:"kira", name:"Kira",  emoji:"💎",owner:"Emeka",       bg:"#F8E8FF",color:"#9333EA" },
    ],
  },
];

/* ══ SEED BATTLES ═══════════════════════════════════════════════════════════ */
export const SEED_BATTLES = [
  { id:"SEED-001",challenger:"Jordan M.",avatar:"https://i.pravatar.cc/150?img=12",subject:"maths",title:"Speed Algebra Duel",description:"10 linear equations. First to finish with 100% accuracy wins.",xpPrize:"+250 XP",timeLimit:"15 min",difficulty:"hard",status:"live",
    agentA:{ id:"nexus",name:"Nexus",emoji:"🤖",owner:"You",      ownerEmoji:"👤",bg:"#FEF0E6",color:"#E8884A",isYou:true, score:6,hp:62 },
    agentB:{ id:"sigma",name:"Sigma",emoji:"🔺",owner:"Jordan M.",ownerEmoji:"👦🏽",bg:"#C8D8E8",color:"#2563EB",score:4,hp:78 },
    topic:"Speed Algebra Duel",viewers:14,xpPool:250,currentQNum:7,totalQ:15,winner:null,startedAgo:6,startsIn:null,
    question:{ q:"Solve for x: 5x − 3 = 22",opts:["x = 4","x = 5","x = 3","x = 6"],ans:1,topic:"Algebra",xp:40 } },
  { id:"SEED-002",challenger:"Priya K.",avatar:"https://i.pravatar.cc/150?img=44",subject:"english",title:"Vocabulary Blitz",description:"50 vocab words from the SAT prep list.",xpPrize:"+180 XP",timeLimit:"10 min",difficulty:"medium",status:"completed",
    agentA:{ id:"nexus",name:"Nexus",emoji:"🤖",owner:"You",    ownerEmoji:"👤",bg:"#FEF0E6",color:"#E8884A",isYou:true, score:9, hp:0  },
    agentB:{ id:"ada",  name:"Ada",  emoji:"✨",owner:"Priya K.",ownerEmoji:"👧🏽",bg:"#E4D4F0",color:"#7C3AED",score:11,hp:28 },
    topic:"Vocabulary Blitz",viewers:0,xpPool:180,currentQNum:15,totalQ:15,winner:"ada",startedAgo:null,startsIn:null,
    question:{ q:"What does 'ephemeral' mean?",opts:["Permanent","Short-lived","Ancient","Enormous"],ans:1,topic:"Vocabulary",xp:30 } },
  { id:"SEED-003",challenger:"Marcus B.",avatar:"https://i.pravatar.cc/150?img=57",subject:"science",title:"Periodic Table Sprint",description:"Name the element, symbol, and atomic number from 20 prompts.",xpPrize:"+200 XP",timeLimit:"12 min",difficulty:"hard",status:"scheduled",
    agentA:{ id:"nexus",name:"Nexus",emoji:"🤖",owner:"You",      ownerEmoji:"👤",bg:"#FEF0E6",color:"#E8884A",isYou:true, score:0,hp:100 },
    agentB:{ id:"kira", name:"Kira", emoji:"💎",owner:"Marcus B.",ownerEmoji:"👨🏾",bg:"#F8E8FF",color:"#9333EA",score:0,hp:100 },
    topic:"Periodic Table Sprint",viewers:0,xpPool:200,currentQNum:0,totalQ:15,winner:null,startedAgo:null,startsIn:"Tomorrow 4:00 PM",
    question:{ q:"What is the symbol for Gold?",opts:["Go","Gd","Au","Ag"],ans:2,topic:"Elements",xp:35 } },
  { id:"SEED-004",challenger:"Dr. Amara (Teacher)",avatar:"https://i.pravatar.cc/150?img=47",subject:"maths",title:"Calculus Class Championship",description:"Teacher's agent Pythia challenges the entire class.",xpPrize:"+500 XP",timeLimit:"20 min",difficulty:"hard",status:"live",battleType:"classroom",viewers:18,xpPool:500,currentQNum:5,totalQ:15,winner:null,startedAgo:4,startsIn:null,
    agentA:{ id:"pythia",name:"Pythia",emoji:"🔮",owner:"Dr. Amara",ownerEmoji:"👩🏾‍💻",bg:"#EDE8F8",color:"#7C3AED",isTeacher:true,score:8,hp:72 },
    agentB:{ id:"nexus",name:"Nexus",emoji:"🤖",owner:"You",ownerEmoji:"👤",bg:"#FEF0E6",color:"#E8884A",isYou:true,score:5,hp:85 },
    participants:[
      { id:"nexus",name:"Nexus",emoji:"🤖",owner:"You",        bg:"#FEF0E6",color:"#E8884A",isYou:true, score:5,hp:85 },
      { id:"ada",  name:"Ada",  emoji:"✨",owner:"Ngozi",      bg:"#E4D4F0",color:"#7C3AED",            score:7,hp:70 },
      { id:"sigma",name:"Sigma",emoji:"🔺",owner:"Jordan M.",  bg:"#C8D8E8",color:"#2563EB",            score:4,hp:90 },
      { id:"zeno", name:"Zeno", emoji:"🌀",owner:"Chukwuemeka",bg:"#D4EAD8",color:"#059669",            score:6,hp:78 },
      { id:"lyra", name:"Lyra", emoji:"🌙",owner:"Amaka",      bg:"#F0E4C8",color:"#D97706",            score:3,hp:94 },
      { id:"kira", name:"Kira", emoji:"💎",owner:"Emeka",      bg:"#F8E8FF",color:"#9333EA",            score:9,hp:62 },
    ],
    question:{ q:"Find dy/dx if y = sin(3x² + 2x)",opts:["cos(3x² + 2x)","(6x + 2)cos(3x² + 2x)","sin(6x + 2)","−cos(3x² + 2x)"],ans:1,topic:"Chain Rule",xp:40 } },
];

/* ══ QUESTION BANKS ═════════════════════════════════════════════════════════ */
export const Q_ALGEBRA = [
  { q:"Solve for x: 3x + 7 = 22",                  opts:["x = 3","x = 4","x = 5","x = 6"],                             ans:2,topic:"Algebra",    xp:30 },
  { q:"Solve for x: 5x − 3 = 22",                  opts:["x = 4","x = 5","x = 3","x = 6"],                             ans:1,topic:"Algebra",    xp:30 },
  { q:"If 2x + 4 = 14, what is x?",                opts:["3","4","5","6"],                                              ans:2,topic:"Algebra",    xp:25 },
  { q:"Simplify: 3(2x − 4) + 6",                   opts:["6x − 6","6x + 6","6x − 18","6x − 12"],                       ans:0,topic:"Algebra",    xp:35 },
  { q:"What is the slope of y = 4x − 7?",          opts:["−7","4","7","−4"],                                            ans:1,topic:"Linear",     xp:25 },
  { q:"Solve: 2x/3 = 8",                           opts:["x = 8","x = 10","x = 12","x = 6"],                           ans:2,topic:"Algebra",    xp:35 },
  { q:"If 4x − 6 = 2x + 10, find x",              opts:["x = 6","x = 7","x = 8","x = 4"],                             ans:2,topic:"Algebra",    xp:40 },
  { q:"Factorise: x² + 5x + 6",                   opts:["(x+2)(x+3)","(x+1)(x+6)","(x+2)(x+4)","(x+3)(x+4)"],        ans:0,topic:"Quadratic",  xp:40 },
  { q:"Solve: x² − 9 = 0",                        opts:["x = 3","x = ±3","x = ±9","x = 9"],                           ans:1,topic:"Quadratic",  xp:35 },
  { q:"What is the y-intercept of y = 3x + 5?",   opts:["3","0","5","−3"],                                             ans:2,topic:"Linear",     xp:25 },
  { q:"If f(x) = 2x + 1, what is f(4)?",          opts:["7","8","9","10"],                                             ans:2,topic:"Functions",  xp:30 },
  { q:"Solve the inequality: 3x + 2 > 11",        opts:["x > 2","x > 3","x > 4","x > 1"],                             ans:1,topic:"Inequalities",xp:30 },
  { q:"Which is a solution to x² − 5x + 6 = 0?", opts:["x = 1","x = 2","x = 4","x = 5"],                             ans:1,topic:"Quadratic",  xp:40 },
  { q:"Expand: (x + 3)²",                         opts:["x² + 9","x² + 6x + 9","x² + 3x + 9","x² + 6x + 6"],         ans:1,topic:"Algebra",    xp:35 },
  { q:"Solve simultaneously: x + y = 10, x − y = 2",opts:["x=6,y=4","x=7,y=3","x=5,y=5","x=8,y=2"],                  ans:0,topic:"Simultaneous",xp:45 },
];
export const Q_GEOMETRY = [
  { q:"Area of a triangle with base 8 and height 5?",           opts:["20","40","25","16"],                            ans:0,topic:"Area",       xp:25 },
  { q:"Perimeter of a rectangle: length 7, width 4?",          opts:["22","28","11","14"],                             ans:0,topic:"Perimeter",  xp:25 },
  { q:"Sum of interior angles of a pentagon?",                  opts:["360°","540°","480°","720°"],                     ans:1,topic:"Polygons",   xp:35 },
  { q:"Area of a circle with radius 7? (Use π ≈ 3.14)",        opts:["43.96","153.86","21.98","49"],                   ans:1,topic:"Circles",    xp:35 },
  { q:"The diagonal of a square with side 5 is?",              opts:["5√2","5","10","25"],                             ans:0,topic:"Pythagoras", xp:40 },
  { q:"What type of triangle has all sides equal?",            opts:["Scalene","Isosceles","Equilateral","Right"],      ans:2,topic:"Triangles",  xp:20 },
  { q:"Volume of a cube with side 4?",                         opts:["16","32","48","64"],                             ans:3,topic:"Volume",     xp:30 },
  { q:"Circumference of circle with diameter 10? (π ≈ 3.14)", opts:["31.4","62.8","15.7","10π"],                      ans:0,topic:"Circles",    xp:30 },
  { q:"Angle in a semicircle is always?",                      opts:["45°","60°","90°","180°"],                        ans:2,topic:"Circles",    xp:35 },
  { q:"Hypotenuse of a right triangle with legs 3 and 4?",    opts:["5","6","7","√7"],                                ans:0,topic:"Pythagoras", xp:35 },
  { q:"Area of a parallelogram: base 9, height 6?",           opts:["27","54","63","45"],                             ans:1,topic:"Area",       xp:30 },
  { q:"How many axes of symmetry does a square have?",        opts:["2","3","4","8"],                                 ans:2,topic:"Symmetry",   xp:25 },
  { q:"What is the exterior angle of a regular hexagon?",     opts:["45°","60°","72°","90°"],                         ans:1,topic:"Polygons",   xp:35 },
  { q:"Surface area of a cube with side 3?",                  opts:["27","36","54","18"],                             ans:2,topic:"Surface Area",xp:35 },
  { q:"Alternate interior angles are?",                       opts:["Supplementary","Equal","Complementary","Reflex"],ans:1,topic:"Angles",     xp:40 },
];
export const Q_VOCABULARY = [
  { q:"What does 'ephemeral' mean?",          opts:["Permanent","Short-lived","Ancient","Enormous"],              ans:1,topic:"Vocabulary",xp:30 },
  { q:"'Ubiquitous' means?",                  opts:["Rare","Present everywhere","Ancient","Invisible"],           ans:1,topic:"Vocabulary",xp:30 },
  { q:"'Loquacious' means?",                  opts:["Silent","Fearful","Talkative","Wise"],                       ans:2,topic:"Vocabulary",xp:30 },
  { q:"'Benevolent' most closely means?",     opts:["Cruel","Well-meaning","Cowardly","Boastful"],                ans:1,topic:"Vocabulary",xp:25 },
  { q:"Synonym for 'audacious'?",             opts:["Timid","Bold","Quiet","Careful"],                           ans:1,topic:"Synonyms",  xp:30 },
  { q:"'Ambiguous' means?",                   opts:["Clear","Obvious","Open to interpretation","Definite"],       ans:2,topic:"Vocabulary",xp:35 },
  { q:"'Pragmatic' means?",                   opts:["Idealistic","Practical","Emotional","Reckless"],            ans:1,topic:"Vocabulary",xp:30 },
  { q:"Antonym of 'verbose' is?",             opts:["Wordy","Lengthy","Concise","Repetitive"],                   ans:2,topic:"Antonyms",  xp:35 },
  { q:"'Melancholy' refers to?",              opts:["Happiness","Deep sadness","Confusion","Excitement"],        ans:1,topic:"Vocabulary",xp:25 },
  { q:"What does 'tenacious' mean?",          opts:["Weak","Persistent","Timid","Unpredictable"],                ans:1,topic:"Vocabulary",xp:30 },
  { q:"'Exacerbate' means to?",               opts:["Improve","Examine","Worsen","Explain"],                     ans:2,topic:"Vocabulary",xp:35 },
  { q:"What is an 'oxymoron'?",               opts:["Contradictory terms","A metaphor","A rhyming pair","Exaggeration"],ans:0,topic:"Figures",xp:40 },
  { q:"'Reticent' means?",                    opts:["Enthusiastic","Reserved","Honest","Bold"],                  ans:1,topic:"Vocabulary",xp:30 },
  { q:"Choose correct spelling:",             opts:["Accomodate","Accommodate","Acommodate","Accommadate"],       ans:1,topic:"Spelling",  xp:25 },
  { q:"'Sycophant' means?",                   opts:["A leader","A flatterer","A critic","A scholar"],            ans:1,topic:"Vocabulary",xp:40 },
];
export const Q_GRAMMAR = [
  { q:"Which sentence is correct?",           opts:["She don't like it.","She doesn't likes it.","She doesn't like it.","She not like it."],ans:2,topic:"Grammar",      xp:25 },
  { q:"'Their' indicates?",                   opts:["A place","Belonging to them","They are","There"],            ans:1,topic:"Homophones",   xp:25 },
  { q:"Identify the adverb: 'She runs quickly'",opts:["She","runs","quickly","the"],                             ans:2,topic:"Parts of Speech",xp:25 },
  { q:"Which is a compound sentence?",        opts:["I went home.","Although it rained, I walked.","I ate, and she drank.","Running is fun."],ans:2,topic:"Sentence Types",xp:30 },
  { q:"Plural of 'analysis' is?",             opts:["Analysises","Analyses","Analysees","Analysis"],             ans:1,topic:"Plurals",      xp:30 },
  { q:"'Fewer' is used with?",                opts:["Uncountable nouns","Countable nouns","Adjectives","Verbs"], ans:1,topic:"Grammar",      xp:30 },
  { q:"Which word is a conjunction?",         opts:["Quickly","Beautiful","Although","Running"],                 ans:2,topic:"Parts of Speech",xp:25 },
  { q:"'Its' or 'It's'?",                    opts:["Its=possession, It's=It is","Same meaning","It's wrong","Its always correct"],ans:0,topic:"Punctuation",xp:35 },
  { q:"A clause that cannot stand alone is?", opts:["Independent","Dependent","Main","Compound"],                ans:1,topic:"Clauses",      xp:35 },
  { q:"'Neither…nor' is?",                   opts:["Correlative conjunction","Relative pronoun","Subordinating conjunction","Article"],ans:0,topic:"Conjunctions",xp:35 },
  { q:"Past tense of 'lie' (to recline)?",    opts:["Lied","Lay","Lain","Layed"],                               ans:1,topic:"Tense",        xp:35 },
  { q:"Which uses Oxford comma?",             opts:["cats dogs and birds","cats, dogs and birds","cats, dogs, and birds","cats dogs, and birds"],ans:2,topic:"Punctuation",xp:30 },
  { q:"A word that modifies a verb is?",      opts:["Adjective","Adverb","Article","Noun"],                      ans:1,topic:"Parts of Speech",xp:25 },
  { q:"'She is the person ___ I trust'",      opts:["Who","Whom","Whose","Which"],                              ans:1,topic:"Pronouns",     xp:40 },
  { q:"Which is passive voice?",              opts:["The dog bit the man.","The man bit the dog.","The man was bitten.","The dog bites."],ans:2,topic:"Voice",xp:40 },
];
export const Q_PERIODIC = [
  { q:"Chemical symbol for Gold?",                    opts:["Go","Gd","Au","Ag"],                              ans:2,topic:"Elements",  xp:30 },
  { q:"Atomic number of Carbon?",                     opts:["6","8","12","14"],                                ans:0,topic:"Elements",  xp:25 },
  { q:"Which element has symbol 'Fe'?",               opts:["Fluorine","Iron","Francium","Fermium"],           ans:1,topic:"Elements",  xp:30 },
  { q:"Symbol for Sodium?",                           opts:["So","Sd","Sn","Na"],                             ans:3,topic:"Elements",  xp:30 },
  { q:"Noble gas with atomic number 2?",              opts:["Neon","Argon","Helium","Krypton"],               ans:2,topic:"Noble Gases",xp:25 },
  { q:"'K' stands for?",                             opts:["Krypton","Potassium","Kurchatovium","Calcium"],   ans:1,topic:"Elements",  xp:30 },
  { q:"Lightest element?",                            opts:["Helium","Lithium","Hydrogen","Oxygen"],          ans:2,topic:"Elements",  xp:25 },
  { q:"Atomic number of Oxygen?",                     opts:["6","7","8","9"],                                 ans:2,topic:"Elements",  xp:25 },
  { q:"Symbol for Mercury?",                          opts:["Mr","Me","Hg","Mc"],                            ans:2,topic:"Elements",  xp:35 },
  { q:"Which element is a halogen?",                  opts:["Neon","Chlorine","Argon","Sodium"],             ans:1,topic:"Groups",    xp:30 },
  { q:"What period is Carbon in?",                    opts:["1","2","3","4"],                                ans:1,topic:"Periods",   xp:30 },
  { q:"Highest electronegativity?",                   opts:["Oxygen","Nitrogen","Chlorine","Fluorine"],      ans:3,topic:"Properties",xp:40 },
  { q:"Symbol for Lead?",                             opts:["Le","Li","Pb","Ld"],                           ans:2,topic:"Elements",  xp:35 },
  { q:"Liquid non-metal at room temperature?",        opts:["Mercury","Bromine","Gallium","Cesium"],        ans:1,topic:"States",    xp:40 },
  { q:"Atomic number of Nitrogen?",                   opts:["5","6","7","8"],                               ans:2,topic:"Elements",  xp:25 },
];
export const Q_NEWTON = [
  { q:"Newton's 1st Law is called?",                   opts:["Law of Acceleration","Law of Inertia","Law of Action-Reaction","Law of Gravity"],ans:1,topic:"Newton's Laws",xp:25 },
  { q:"Force = ?",                                     opts:["mass × velocity","mass × acceleration","weight × speed","mass × distance"],    ans:1,topic:"Equations",   xp:30 },
  { q:"Unit that measures force?",                     opts:["Joule","Watt","Newton","Pascal"],                                               ans:2,topic:"Units",       xp:25 },
  { q:"Newton's 3rd Law states?",                      opts:["F=ma","Objects in motion…","Every action has equal opposite reaction","Gravity is constant"],ans:2,topic:"Newton's Laws",xp:30 },
  { q:"Object at rest stays at rest unless?",          opts:["Gravity acts","Terminal velocity","External force acts","Mass increases"],      ans:2,topic:"Inertia",     xp:30 },
  { q:"Mass doubled, acceleration halved, force?",     opts:["Doubles","Halves","Stays same","Quadruples"],                                  ans:2,topic:"F=ma",        xp:40 },
  { q:"Weight of 10kg (g=10)?",                       opts:["10 N","100 N","1 N","1000 N"],                                                 ans:1,topic:"Weight",      xp:30 },
  { q:"Friction is a type of?",                        opts:["Balanced force","Contact force","Non-contact force","Gravitational force"],    ans:1,topic:"Forces",      xp:30 },
  { q:"Rocket launches because of Newton's?",          opts:["1st Law","2nd Law","3rd Law","Law of Gravitation"],                           ans:2,topic:"Newton's Laws",xp:35 },
  { q:"Terminal velocity when?",                       opts:["Acceleration = max","Net force = 0","Mass increases","Speed decreases"],       ans:1,topic:"Motion",      xp:40 },
  { q:"More inertia — 5kg or 50kg?",                  opts:["5kg","50kg","Both same","Depends on speed"],                                   ans:1,topic:"Inertia",     xp:25 },
  { q:"SI unit of mass?",                              opts:["Newton","Kilogram","Pound","Gram"],                                            ans:1,topic:"Units",       xp:20 },
  { q:"Net force in equilibrium?",                     opts:["Maximum","Minimum","Zero","Constant"],                                        ans:2,topic:"Equilibrium", xp:30 },
  { q:"Speed = ?",                                     opts:["distance / time","time / distance","force × mass","acceleration × time"],      ans:0,topic:"Equations",   xp:25 },
  { q:"Mass 4kg, accel 5m/s². Force?",                opts:["20 N","9 N","1.25 N","25 N"],                                                 ans:0,topic:"F=ma",        xp:40 },
];
export const Q_CALCULUS = [
  { q:"Find dy/dx if y = sin(3x² + 2x)",          opts:["cos(3x² + 2x)","(6x + 2)cos(3x² + 2x)","sin(6x + 2)","−cos(3x² + 2x)"],ans:1,topic:"Chain Rule",         xp:40 },
  { q:"What is lim(x→0) sin(x)/x?",               opts:["0","∞","1","Undefined"],                                                  ans:2,topic:"Limits",            xp:35 },
  { q:"Integrate ∫ 3x² dx",                        opts:["6x + C","x³ + C","x³","3x³ + C"],                                       ans:1,topic:"Integration",       xp:30 },
  { q:"If f(x) = e^(2x), what is f'(x)?",         opts:["e^(2x)","2e^x","2e^(2x)","e^x"],                                        ans:2,topic:"Differentiation",   xp:35 },
  { q:"Product rule for d/dx[u·v]?",               opts:["u'v'","u'v + uv'","uv' − u'v","(u'v')/(u+v)"],                         ans:1,topic:"Product Rule",      xp:30 },
  { q:"Find ∫ cos(x) dx",                          opts:["−sin(x) + C","sin(x) + C","cos(x) + C","tan(x) + C"],                  ans:1,topic:"Integration",       xp:25 },
  { q:"Derivative of ln(x)?",                      opts:["x","1/x","e^x","ln(x)/x"],                                              ans:1,topic:"Differentiation",   xp:30 },
  { q:"Find lim(x→∞) 1/x",                        opts:["1","∞","0","Undefined"],                                                  ans:2,topic:"Limits",            xp:25 },
  { q:"If y = x⁴ − 3x² + 7, find y''",           opts:["4x³ − 6x","12x² − 6","x⁵ − x³","4x² − 3"],                            ans:1,topic:"Differentiation",   xp:40 },
  { q:"∫ e^x dx = ?",                              opts:["e^(x+1)/(x+1)","e^x + C","xe^x + C","1/e^x + C"],                     ans:1,topic:"Integration",       xp:30 },
  { q:"Chain rule: d/dx[f(g(x))] = ?",            opts:["f'(x)·g'(x)","f(g'(x))","f'(g(x))·g'(x)","f'(g(x)) + g'(x)"],         ans:2,topic:"Chain Rule",        xp:35 },
  { q:"Quotient rule: d/dx[u/v] = ?",             opts:["(u'v + uv')/v²","(u'v − uv')/v²","u'/v'","(uv' − u'v)/v²"],           ans:1,topic:"Quotient Rule",     xp:40 },
  { q:"Evaluate ∫₀¹ x dx",                        opts:["1","1/2","2","0"],                                                        ans:1,topic:"Definite Integrals",xp:35 },
  { q:"Second derivative of sin(x)?",              opts:["cos(x)","−cos(x)","−sin(x)","sin(x)"],                                  ans:2,topic:"Higher Derivatives",xp:40 },
  { q:"Solve: dy/dx = 2y, y(0) = 3",              opts:["y = 3e^(2x)","y = 2e^(3x)","y = 3 + 2x","y = e^(2x)"],                ans:0,topic:"Diff Equations",    xp:50 },
];
const QUESTIONS_MAP = {
  "Speed Algebra Duel":   Q_ALGEBRA,
  "Geometry Quick-Fire":  Q_GEOMETRY,
  "Vocabulary Blitz":     Q_VOCABULARY,
  "Grammar Gauntlet":     Q_GRAMMAR,
  "Periodic Table Sprint":Q_PERIODIC,
  "Newton's Laws Blitz":  Q_NEWTON,
};
export function getQuestions(title) { return QUESTIONS_MAP[title] || Q_CALCULUS; }
export const QUESTIONS = Q_CALCULUS;

/* ══ LEADERBOARD ════════════════════════════════════════════════════════════ */
export const LEADERBOARD = {
  interSchool:[
    {rank:1,name:"Westwood Academy",  avatar:"https://i.pravatar.cc/150?img=10",xp:48200,badge:"🥇",students:312,change:"+2"},
    {rank:2,name:"Riverside High",    avatar:"https://i.pravatar.cc/150?img=11",xp:44750,badge:"🥈",students:287,change:"—"},
    {rank:3,name:"Summit Prep",       avatar:"https://i.pravatar.cc/150?img=13",xp:41300,badge:"🥉",students:265,change:"-1"},
    {rank:4,name:"Lakeside STEM",     avatar:"https://i.pravatar.cc/150?img=14",xp:38900,badge:"",  students:241,change:"+1"},
    {rank:5,name:"Oakwood Charter",   avatar:"https://i.pravatar.cc/150?img=16",xp:35600,badge:"",  students:198,change:"-2"},
    {rank:6,name:"Greenfield IB",     avatar:"https://i.pravatar.cc/150?img=17",xp:32100,badge:"",  students:176,change:"+3"},
    {rank:7,name:"North Valley High", avatar:"https://i.pravatar.cc/150?img=18",xp:29800,badge:"",  students:220,change:"—"},
    {rank:8,name:"Cedar Grove School",avatar:"https://i.pravatar.cc/150?img=19",xp:27400,badge:"",  students:189,change:"-1"},
  ],
  courses:[
    {rank:1,name:"Algebra Fundamentals",avatar:"https://i.pravatar.cc/150?img=47",xp:9820, badge:"🥇",subject:"maths",  change:"+1",completions:142},
    {rank:2,name:"Newton's Laws",       avatar:"https://i.pravatar.cc/150?img=52",xp:8750, badge:"🥈",subject:"science",change:"—", completions:118},
    {rank:3,name:"Creative Writing",    avatar:"https://i.pravatar.cc/150?img=33",xp:8100, badge:"🥉",subject:"english",change:"+2",completions:105},
    {rank:4,name:"Cell Biology",        avatar:"https://i.pravatar.cc/150?img=52",xp:7640, badge:"",  subject:"science",change:"-2",completions:97 },
    {rank:5,name:"Triangle Congruence", avatar:"https://i.pravatar.cc/150?img=47",xp:6980, badge:"",  subject:"maths",  change:"—", completions:88 },
    {rank:6,name:"Literature Analysis", avatar:"https://i.pravatar.cc/150?img=44",xp:6320, badge:"",  subject:"english",change:"+1",completions:79 },
    {rank:7,name:"Mitosis & Meiosis",   avatar:"https://i.pravatar.cc/150?img=52",xp:5890, badge:"",  subject:"science",change:"-1",completions:71 },
    {rank:8,name:"Narrative Voice",     avatar:"https://i.pravatar.cc/150?img=33",xp:5410, badge:"",  subject:"english",change:"+3",completions:64 },
  ],
  classroom:[
    {rank:1,name:"Alex Johnson",avatar:"https://i.pravatar.cc/150?img=15",xp:2840,badge:"🥇",isMe:true, change:"+2",streak:14},
    {rank:2,name:"Jordan M.",   avatar:"https://i.pravatar.cc/150?img=12",xp:2650,badge:"🥈",isMe:false,change:"—", streak:9 },
    {rank:3,name:"Priya K.",    avatar:"https://i.pravatar.cc/150?img=44",xp:2490,badge:"🥉",isMe:false,change:"+1",streak:7 },
    {rank:4,name:"Marcus B.",   avatar:"https://i.pravatar.cc/150?img=57",xp:2310,badge:"",  isMe:false,change:"-1",streak:5 },
    {rank:5,name:"Aaliyah T.",  avatar:"https://i.pravatar.cc/150?img=32",xp:2180,badge:"",  isMe:false,change:"+3",streak:12},
    {rank:6,name:"Leon S.",     avatar:"https://i.pravatar.cc/150?img=68",xp:1970,badge:"",  isMe:false,change:"—", streak:4 },
    {rank:7,name:"Sasha M.",    avatar:"https://i.pravatar.cc/150?img=47",xp:1840,badge:"",  isMe:false,change:"-2",streak:2 },
    {rank:8,name:"Devon R.",    avatar:"https://i.pravatar.cc/150?img=33",xp:1720,badge:"",  isMe:false,change:"+1",streak:6 },
  ],
};

/* ══ DECAY ALERTS ═══════════════════════════════════════════════════════════ */
// sessionId maps to the session that needs a decay review badge
export const MOCK_DECAY_ALERTS = [
  {
    id: "dec-001",
    sessionId: "SES-003",
    topic: "Mitosis & Meiosis",
    subject: "science",
    confidence: 31,
    prevConfidence: 68,
    daysSince: 14,
    misconceptions: ["confused anaphase with telophase"],
  },
  {
    id: "dec-002",
    sessionId: "SES-005",
    topic: "Themes in To Kill a Mockingbird",
    subject: "english",
    confidence: 71,
    prevConfidence: 88,
    daysSince: 8,
    misconceptions: ["missed Scout's coming-of-age arc", "confused Atticus's moral stance"],
  },
  {
    id: "dec-003",
    sessionId: "SES-006",
    topic: "Newton's Laws & Forces",
    subject: "science",
    confidence: 34,
    prevConfidence: 55,
    daysSince: 21,
    misconceptions: ["confused acceleration with velocity", "incorrect force diagram setup"],
  },
];

/* ══ AGENT CONTINUATION SESSIONS ════════════════════════════════════════════
   These are past adaptive sessions the student has already taught to their
   agent. Shown in Agent tab → Sessions sub-tab.
   Topics are intentionally different from MOCK_DECAY_ALERTS to avoid overlap.
════════════════════════════════════════════════════════════════════════════ */
export const AGENT_SESSIONS = [
  {
    id:             "SES-A01",
    type:           "agent",
    status:         "complete",
    title:          "Cell Respiration",
    topic:          "Cell Respiration",
    subject:        "science",
    avatar:         "https://i.pravatar.cc/150?img=32",
    tutor:          "AI Agent",
    level:          "Adaptive",
    nextSession:    "3d ago",
    daysSince:      3,
    topics:         3,
    revisions:      6,
    reviews:        4,
    progress:       78,
    avgConfidence:  78,
    subtopicCount:  3,
    subtopicList:   ["ATP Production", "Glycolysis", "Krebs Cycle"],
    misconceptions: ["confused ADP with ATP cycle timing"],
    unread:         0,
    priority:       "medium",
    scheduleBucket: "later",
    hasHistory:     true,
    startsAt:       new Date(Date.now() - 3 * 86400000).toISOString(),
  },
  {
    id:             "SES-A02",
    type:           "agent",
    status:         "complete",
    title:          "Macbeth — Themes & Characters",
    topic:          "Macbeth — Themes & Characters",
    subject:        "english",
    avatar:         "https://i.pravatar.cc/150?img=41",
    tutor:          "AI Agent",
    level:          "Adaptive",
    nextSession:    "5d ago",
    daysSince:      5,
    topics:         4,
    revisions:      8,
    reviews:        6,
    progress:       85,
    avgConfidence:  85,
    subtopicCount:  4,
    subtopicList:   ["Ambition & Power", "Guilt & Conscience", "Lady Macbeth", "Fate vs Free Will"],
    misconceptions: [],
    unread:         0,
    priority:       "low",
    scheduleBucket: "later",
    hasHistory:     true,
    startsAt:       new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    id:             "SES-A03",
    type:           "agent",
    status:         "active",
    title:          "Quadratic Equations",
    topic:          "Quadratic Equations",
    subject:        "maths",
    avatar:         "https://i.pravatar.cc/150?img=27",
    tutor:          "AI Agent",
    level:          "Adaptive",
    nextSession:    "10d ago",
    daysSince:      10,
    topics:         2,
    revisions:      3,
    reviews:        2,
    progress:       72,
    avgConfidence:  72,
    subtopicCount:  2,
    subtopicList:   ["Factoring", "Quadratic Formula"],
    misconceptions: ["incomplete discriminant understanding"],
    unread:         0,
    priority:       "medium",
    scheduleBucket: "later",
    hasHistory:     true,
    startsAt:       new Date(Date.now() - 10 * 86400000).toISOString(),
  },
];

/* ══ CONTINUATION SESSION HISTORY ═══════════════════════════════════════════
   Pre-written block history for each AGENT_SESSION.
   Used by buildContinuationHistory() when REST /history is unavailable.
   Each entry maps sessionId → array of faded typed blocks.
════════════════════════════════════════════════════════════════════════════ */
export const CONTINUATION_HISTORY = {

  /* ─── SES-A01 · Cell Respiration · 3 days ago ─────────────────────────── */
  "SES-A01": [
    { type:"system-divider", label:"Previous session · 3 days ago" },

    { type:"subtopic-hdr", faded:true, subtopic:"ATP Production",
      idx:0, total:3, topic:"Cell Respiration", subject:"science" },
    { type:"plan", faded:true, phases:[
      "Phase 1 → what do they know","Phase 2 → must-know parts",
      "Phase 3 → teach it back","Phase 4 → push further"] },
    { type:"objectives", faded:true, subtopic:"ATP Production", items:[
      "Define ATP and explain its role as an energy carrier",
      "Describe the structure of ATP (adenine + ribose + 3 phosphates)",
      "Explain how energy is released when ATP is hydrolysed to ADP"] },
    { type:"guide", faded:true, agent:"NaNa Esumai", emoji:"🧠",
      phase:"Phase 1 — Set the scene",
      text:"Alright! We're starting with ATP Production. Atlas, get ready to learn. Human — explain what ATP is and why the cell needs it, as if Atlas has never encountered it before." },
    { type:"student-agent", faded:true, agent:"Aria", emoji:"🤖",
      phase:"Aria · scanning knowledge base…", confidence:15,
      text:"I have very limited data on ATP Production. What is ATP and why does the cell need it?" },
    { type:"user", faded:true,
      text:"ATP stands for Adenosine Triphosphate. It's basically the cell's energy currency — like cash. When the cell needs energy to do work, it breaks one of ATP's phosphate bonds, releasing energy and turning into ADP. This happens in almost every cellular process." },
    { type:"student-agent", faded:true, agent:"Aria", emoji:"🤖",
      phase:"Aria · Phase 2 · 38%", confidence:38,
      text:"I understand more now. ATP stores energy in its phosphate bonds and releases it by converting to ADP. What triggers this conversion and how is ATP regenerated?" },
    { type:"guide", faded:true, agent:"NaNa Esumai", emoji:"🧠",
      phase:"Phase 2 — gap identified",
      text:"Good start! Aria's picking up the ATP↔ADP cycle. Now cover the regeneration — where does the energy come from to rebuild ATP? That's where respiration connects." },
    { type:"user", faded:true,
      text:"ATP gets regenerated during cellular respiration. Glucose is broken down through glycolysis and the Krebs cycle, and the energy released is used to reattach a phosphate group to ADP, reforming ATP. It's basically a rechargeable battery." },
    { type:"student-agent", faded:true, agent:"Aria", emoji:"🤖",
      phase:"Aria · Phase 3 · 62%", confidence:62,
      text:"So ATP is a rechargeable energy carrier. Respiration breaks down glucose to release energy, which reattaches phosphate to ADP making ATP. When work is needed, the bond breaks again releasing that energy." },
    { type:"guide", faded:true, agent:"NaNa Esumai", emoji:"🧠",
      phase:"Phase 4 — causal reasoning",
      text:"Solid conceptual grasp! Now push further — if a cell was given a poison that blocked ATP hydrolysis, what would stop working first?" },
    { type:"user", faded:true,
      text:"If ATP couldn't be hydrolysed, the cell couldn't release energy for active transport, muscle contraction, protein synthesis — basically every energy-requiring process would shut down almost immediately." },
    { type:"student-agent", faded:true, agent:"Aria", emoji:"🤖",
      phase:"Aria · Phase 4 · 76%", confidence:76,
      text:"I can reason causally now. ATP hydrolysis → energy release → all active cellular processes. Block hydrolysis → no usable energy → cell death. The phosphate bond is the critical energy release mechanism." },
    { type:"sargeant", faded:true, phase:"Assessment gate — ATP Production",
      text:"Before Aria moves to Glycolysis, I need to verify ATP Production is solid.\n\nQuestion: What molecule is produced when ATP releases its energy, and how is ATP regenerated?" },
    { type:"student-agent", faded:true, agent:"Aria", emoji:"🤖",
      phase:"Aria · answering Sargeant", confidence:80,
      text:"ATP hydrolysis produces ADP + inorganic phosphate and releases energy. ATP is regenerated when cellular respiration provides energy to reattach the phosphate group to ADP — this happens continuously in active cells." },
    { type:"assess-result", faded:true, subtopic:"ATP Production",
      agentName:"Aria", confidence:80, passed:true,
      nextSubtopic:"Glycolysis" },

    { type:"subtopic-hdr", faded:true, subtopic:"Glycolysis",
      idx:1, total:3, topic:"Cell Respiration", subject:"science" },
    { type:"plan", faded:true, phases:[
      "Phase 1 → what do they know","Phase 2 → must-know parts",
      "Phase 3 → teach it back","Phase 4 → push further"] },
    { type:"guide", faded:true, agent:"NaNa Esumai", emoji:"🧠",
      phase:"Phase 1 — Glycolysis",
      text:"Assessment passed ✓ — moving to Glycolysis. Aria — what do you already know about Glycolysis?" },
    { type:"student-agent", faded:true, agent:"Aria", emoji:"🤖",
      phase:"Aria · scanning knowledge base…", confidence:18,
      text:"Very little data on Glycolysis. I know it involves glucose but I don't know the details." },
    { type:"user", faded:true,
      text:"Glycolysis is the first stage of cellular respiration and it happens in the cytoplasm. It splits one glucose molecule (6 carbons) into two pyruvate molecules (3 carbons each). The net yield is 2 ATP and 2 NADH. It doesn't require oxygen so it happens in both aerobic and anaerobic conditions." },
    { type:"student-agent", faded:true, agent:"Aria", emoji:"🤖",
      phase:"Aria · Phase 3 · 71%", confidence:71,
      text:"Glycolysis: cytoplasm, splits glucose (C6) into 2 pyruvate (C3), net yield 2 ATP + 2 NADH, occurs with or without oxygen. The pyruvate then enters the next stage of respiration if oxygen is available." },
    { type:"assess-result", faded:true, subtopic:"Glycolysis",
      agentName:"Aria", confidence:74, passed:true,
      nextSubtopic:"Krebs Cycle" },

    { type:"subtopic-hdr", faded:true, subtopic:"Krebs Cycle",
      idx:2, total:3, topic:"Cell Respiration", subject:"science" },
    { type:"guide", faded:true, agent:"NaNa Esumai", emoji:"🧠",
      phase:"Phase 1 — Krebs Cycle",
      text:"Last subtopic! Aria — ready for the Krebs Cycle. What do you already know?" },
    { type:"student-agent", faded:true, agent:"Aria", emoji:"🤖",
      phase:"Aria · scanning…", confidence:20,
      text:"I know the Krebs Cycle follows Glycolysis but I need you to teach me the details." },
    { type:"assess-result", faded:true, subtopic:"Krebs Cycle",
      agentName:"Aria", confidence:78, passed:true,
      nextSubtopic:null },
  ],

  /* ─── SES-A02 · Macbeth — Themes & Characters · 5 days ago ────────────── */
  "SES-A02": [
    { type:"system-divider", label:"Previous session · 5 days ago" },

    { type:"subtopic-hdr", faded:true, subtopic:"Ambition & Power",
      idx:0, total:4, topic:"Macbeth — Themes & Characters", subject:"english" },
    { type:"plan", faded:true, phases:[
      "Phase 1 → what do they know","Phase 2 → must-know parts",
      "Phase 3 → teach it back","Phase 4 → push further"] },
    { type:"objectives", faded:true, subtopic:"Ambition & Power", items:[
      "Trace how unchecked ambition corrupts Macbeth from loyal thane to tyrant",
      "Identify key quotes that reveal Macbeth's ambition at different stages",
      "Explain how Shakespeare presents ambition as a destructive force"] },
    { type:"guide", faded:true, agent:"NaNa Esumai", emoji:"🧠",
      phase:"Phase 1 — Set the scene",
      text:"We're starting with Macbeth's central theme: Ambition & Power. Aria, get ready. Human — explain Shakespeare's portrayal of ambition in Macbeth as if Aria has never read the play." },
    { type:"student-agent", faded:true, agent:"Aria", emoji:"🤖",
      phase:"Aria · scanning knowledge base…", confidence:12,
      text:"I have very little data on Macbeth's themes. What is this play about and how does ambition feature?" },
    { type:"user", faded:true,
      text:"Macbeth is a Scottish general who is told by three witches he'll become King. His ambition, encouraged by his wife, drives him to murder King Duncan and seize power. But the more he tries to secure his position, the more paranoid and murderous he becomes. Shakespeare shows ambition as a kind of poison — it starts as a motivator but corrupts everything it touches." },
    { type:"student-agent", faded:true, agent:"Aria", emoji:"🤖",
      phase:"Aria · Phase 2 · 42%", confidence:42,
      text:"So ambition is the catalyst. Macbeth starts loyal but the witches' prophecy activates a latent ambition. Lady Macbeth then amplifies it. Once he acts on it by killing Duncan, he can't stop — each crime requires another to cover it. What specific quotes show this progression?" },
    { type:"guide", faded:true, agent:"NaNa Esumai", emoji:"🧠",
      phase:"Phase 2 — excellent critical thinking",
      text:"Aria's already making connections between theme and structure. Give the key quotes now — Aria needs specific textual evidence to anchor this knowledge." },
    { type:"user", faded:true,
      text:"Act 1: 'I have no spur to prick the sides of my intent, but only vaulting ambition' — Macbeth knows his only motive is ambition, which he recognises as dangerous. Act 3: 'To be thus is nothing, but to be safely thus' — once king, he's paranoid, ambition has become fear. By Act 5 he's numb: 'Tomorrow and tomorrow and tomorrow' — ambition has left him hollow." },
    { type:"student-agent", faded:true, agent:"Aria", emoji:"🤖",
      phase:"Aria · Phase 3 · 78%", confidence:78,
      text:"Three-stage arc: Act 1 — self-aware but reckless ambition ('vaulting ambition'). Act 3 — ambition transforms to paranoid power-preservation. Act 5 — ambition has consumed all meaning, leaving nihilism. Shakespeare presents ambition as self-destroying — it achieves the goal but destroys the person." },
    { type:"guide", faded:true, agent:"NaNa Esumai", emoji:"🧠",
      phase:"Phase 4 — theme analysis confirmed",
      text:"Outstanding! That's A-grade analysis — tracking the theme through the text with evidence. Aria has the core thesis: ambition corrupts. Moving to Sargeant's gate." },
    { type:"sargeant", faded:true, phase:"Assessment gate — Ambition & Power",
      text:"Before Aria moves on, explain how Shakespeare uses language in the 'vaulting ambition' soliloquy to present ambition as dangerous." },
    { type:"student-agent", faded:true, agent:"Aria", emoji:"🤖",
      phase:"Aria · answering Sargeant", confidence:85,
      text:"The extended metaphor of horse-riding ('vaulting', 'prick the sides', 'o'erleaps') presents ambition as something that overreaches and falls. 'Vaulting' suggests reckless overreach. The self-aware tone shows Macbeth KNOWS this is wrong but cannot stop — making him tragic rather than simply villainous." },
    { type:"assess-result", faded:true, subtopic:"Ambition & Power",
      agentName:"Aria", confidence:87, passed:true,
      nextSubtopic:"Guilt & Conscience" },

    { type:"subtopic-hdr", faded:true, subtopic:"Guilt & Conscience",
      idx:1, total:4, topic:"Macbeth — Themes & Characters", subject:"english" },
    { type:"guide", faded:true, agent:"NaNa Esumai", emoji:"🧠",
      phase:"Phase 1 — Guilt & Conscience",
      text:"Moving to Guilt & Conscience. Aria — what do you already know about how guilt manifests in Macbeth?" },
    { type:"student-agent", faded:true, agent:"Aria", emoji:"🤖",
      phase:"Aria · scanning…", confidence:22,
      text:"I know the famous dagger hallucination and the 'Out, damned spot' scene but I need the full picture of how guilt develops." },
    { type:"user", faded:true,
      text:"Guilt in Macbeth manifests as hallucinations — the dagger before the murder, Banquo's ghost at the feast. Shakespeare externalises guilt through these visions. Macbeth is tormented; Lady Macbeth initially suppresses guilt ('unsex me here') but it destroys her by Act 5 — she sleepwalks trying to 'wash' the blood. Their contrasting trajectories show guilt as inescapable." },
    { type:"assess-result", faded:true, subtopic:"Guilt & Conscience",
      agentName:"Aria", confidence:83, passed:true,
      nextSubtopic:"Lady Macbeth" },

    { type:"subtopic-hdr", faded:true, subtopic:"Lady Macbeth",
      idx:2, total:4, topic:"Macbeth — Themes & Characters", subject:"english" },
    { type:"assess-result", faded:true, subtopic:"Lady Macbeth",
      agentName:"Aria", confidence:80, passed:true,
      nextSubtopic:"Fate vs Free Will" },

    { type:"subtopic-hdr", faded:true, subtopic:"Fate vs Free Will",
      idx:3, total:4, topic:"Macbeth — Themes & Characters", subject:"english" },
    { type:"assess-result", faded:true, subtopic:"Fate vs Free Will",
      agentName:"Aria", confidence:85, passed:true,
      nextSubtopic:null },
  ],

  /* ─── SES-A03 · Quadratic Equations · 10 days ago ─────────────────────── */
  "SES-A03": [
    { type:"system-divider", label:"Previous session · 10 days ago" },

    { type:"subtopic-hdr", faded:true, subtopic:"Factoring",
      idx:0, total:2, topic:"Quadratic Equations", subject:"maths" },
    { type:"plan", faded:true, phases:[
      "Phase 1 → what do they know","Phase 2 → must-know parts",
      "Phase 3 → teach it back","Phase 4 → push further"] },
    { type:"objectives", faded:true, subtopic:"Factoring", items:[
      "Factor quadratics of the form x² + bx + c",
      "Factor quadratics of the form ax² + bx + c where a ≠ 1",
      "Identify when a quadratic cannot be factored over integers"] },
    { type:"guide", faded:true, agent:"NaNa Esumai", emoji:"🧠",
      phase:"Phase 1 — Set the scene",
      text:"We're starting with Factoring quadratics. Aria, get ready. Human — explain the factoring method for quadratics to Aria from scratch." },
    { type:"student-agent", faded:true, agent:"Aria", emoji:"🤖",
      phase:"Aria · scanning knowledge base…", confidence:20,
      text:"I know quadratics have the form ax² + bx + c but I don't know the factoring method yet." },
    { type:"user", faded:true,
      text:"To factor x² + bx + c, you look for two numbers that multiply to c and add to b. For example x² + 5x + 6: find two numbers that multiply to 6 and add to 5 — that's 2 and 3. So it factors to (x + 2)(x + 3). You can verify by expanding back. For ax² + bx + c where a ≠ 1, you multiply a by c first, find factors of that product that add to b, then split the middle term and factor by grouping." },
    { type:"student-agent", faded:true, agent:"Aria", emoji:"🤖",
      phase:"Aria · Phase 2 · 45%", confidence:45,
      text:"For x² + bx + c: find two numbers with product = c and sum = b, then write as (x + p)(x + q). For ax² + bx + c: multiply a × c, find factor pair summing to b, split middle term, group and factor. Can you walk me through an ax² example?" },
    { type:"guide", faded:true, agent:"NaNa Esumai", emoji:"🧠",
      phase:"Phase 2 — needs worked example",
      text:"Aria has the method but needs a concrete example for the ax² case. Give one now — step by step." },
    { type:"user", faded:true,
      text:"Sure — 2x² + 7x + 3. Step 1: a×c = 2×3 = 6. Step 2: find factors of 6 that add to 7: that's 1 and 6. Step 3: rewrite as 2x² + x + 6x + 3. Step 4: group — x(2x + 1) + 3(2x + 1). Step 5: factor out (2x + 1) → (2x + 1)(x + 3)." },
    { type:"student-agent", faded:true, agent:"Aria", emoji:"🤖",
      phase:"Aria · Phase 3 · 68%", confidence:68,
      text:"I can follow the grouping method. 2x² + 7x + 3 → ac = 6, factors 1×6, split middle → 2x² + x + 6x + 3 → x(2x+1) + 3(2x+1) → (2x+1)(x+3). The key insight is that (2x+1) appears in both groups." },
    { type:"guide", faded:true, agent:"NaNa Esumai", emoji:"🧠",
      phase:"Phase 4 — push further",
      text:"Good structured method. Now push further — when does factoring NOT work and what clue tells you?" },
    { type:"user", faded:true,
      text:"Factoring over integers doesn't work when the discriminant b² - 4ac is not a perfect square. For example x² + x + 1: discriminant = 1 - 4 = -3, negative, so no real factors at all. x² + 3x + 1: discriminant = 9 - 4 = 5, not a perfect square, so it can't be factored neatly — you'd use the quadratic formula instead." },
    { type:"student-agent", faded:true, agent:"Aria", emoji:"🤖",
      phase:"Aria · Phase 4 · 74%", confidence:74,
      text:"Use discriminant b² - 4ac as a test: if negative → no real roots → can't factor; if positive but not a perfect square → irrational roots → use quadratic formula; if perfect square → rational roots → factorable. This is a useful decision rule before attempting to factor." },
    { type:"sargeant", faded:true, phase:"Assessment gate — Factoring",
      text:"Before moving to the Quadratic Formula, factor this: 3x² − 10x + 8. Show each step." },
    { type:"student-agent", faded:true, agent:"Aria", emoji:"🤖",
      phase:"Aria · answering Sargeant", confidence:72,
      text:"3x² − 10x + 8: ac = 3×8 = 24. Factors of 24 that add to −10: −4 and −6. Rewrite: 3x² − 4x − 6x + 8. Group: x(3x − 4) − 2(3x − 4). Factor: (3x − 4)(x − 2). Check: (3x−4)(x−2) = 3x² − 6x − 4x + 8 = 3x² − 10x + 8 ✓" },
    { type:"assess-result", faded:true, subtopic:"Factoring",
      agentName:"Aria", confidence:72, passed:true,
      nextSubtopic:"Quadratic Formula" },

    { type:"subtopic-hdr", faded:true, subtopic:"Quadratic Formula",
      idx:1, total:2, topic:"Quadratic Equations", subject:"maths" },
    { type:"guide", faded:true, agent:"NaNa Esumai", emoji:"🧠",
      phase:"Phase 1 — Quadratic Formula",
      text:"Last subtopic! Quadratic Formula. Aria — what do you know about it so far?" },
    { type:"student-agent", faded:true, agent:"Aria", emoji:"🤖",
      phase:"Aria · scanning…", confidence:25,
      text:"I know it's x = (-b ± √(b²-4ac)) / 2a but I need to understand when and why to use it." },
    { type:"user", faded:true,
      text:"Use it when factoring fails — when the discriminant isn't a perfect square. The formula always works for any quadratic. The ± gives you both roots. The discriminant b²-4ac tells you the nature of roots: positive = 2 real roots, zero = 1 repeated root, negative = no real roots (complex). For 2x² + 3x - 5: a=2, b=3, c=-5. Discriminant = 9 + 40 = 49. x = (-3 ± 7) / 4. So x = 1 or x = -2.5." },
    { type:"student-agent", faded:true, agent:"Aria", emoji:"🤖",
      phase:"Aria · Phase 3 · 70%", confidence:70,
      text:"Quadratic formula: x = (-b ± √(b²-4ac)) / 2a. Use when factoring fails. Discriminant determines root type. For 2x² + 3x − 5: D = 49, x = (−3 ± 7)/4 giving x = 1 or x = −2.5. But I'm still shaky on discriminant interpretation for incomplete understanding." },
    { type:"assess-result", faded:true, subtopic:"Quadratic Formula",
      agentName:"Aria", confidence:70, passed:true,
      nextSubtopic:null },
  ],
};

/* ══ AGENT / CHAT ════════════════════════════════════════════════════════════ */
export const AGENT_CONFIG = {
  // Student's AI agent
  name:  "Aria",
  emoji: "🤖",
  level: 12,
  avatars: ["🤖","🧠","👾","🦉","🎓","⚡","🌟","🔮","🦋","🎯","🚀","💡"],
  // Default guide agent (NaNa Esumai)
  teacherAgentId: "nana-sargeant",
  guideName:      "NaNa Esumai",
  guideEmoji:     "🧠",
  guideRenderStyle: {
    bubbleBg:     "rgba(124,58,237,0.10)",
    bubbleBorder: "#7C3AED",
    labelColor:   "#7C3AED",
    ttsVoice:     "alloy",
    assessStyle:  "gentle",
  },
};
export const TASKS_INIT = [
  {id:1,title:"Revise Chapter 4 — Linear Equations",    course:"Maths",  priority:"high",  due:"Today",    done:false},
  {id:2,title:"Write essay intro — Mockingbird themes", course:"English",priority:"medium",due:"Tomorrow", done:false},
  {id:3,title:"Watch mitosis animation + take notes",   course:"Science",priority:"high",  due:"Today",    done:false},
  {id:4,title:"Complete practice worksheet on triangles",course:"Maths", priority:"low",   due:"This week",done:true },
  {id:5,title:"Read Chapter 6 — Newton's Laws",         course:"Science",priority:"medium",due:"This week",done:false},
];
export const QUICK_PROMPTS = ["Create a task for me","What's due today?","Quiz me on Algebra","Check my progress","Explain Mitosis","Help with an essay"];
export const AGENT_REPLIES = {
  "Create a task for me":"Sure! What do you need to get done? Tell me the subject and what it's about — I'll add it to your task list.",
  "What's due today?":"📋 Today's tasks:\n\n1. 🔴 Revise Chapter 4 — Linear Equations (Maths)\n2. 🔴 Watch mitosis animation + take notes (Science)\n\nShall I create a study session for either?",
  "Quiz me on Algebra":"Let's go! 🎯\n\nQ1: Solve for x: 3x + 7 = 22\n\nType your answer and I'll check it, then move to the next question.",
  "Check my progress":"📊 This week:\n\n• Algebra: 68% complete · +4 pts\n• Literature: 88% complete · on track ✅\n• Cell Biology: 15% complete · needs attention ⚠️\n\nI'd recommend prioritising Cell Biology next.",
  "Explain Mitosis":"Great topic! 🔬\n\nMitosis is how a cell divides into two identical daughters. 4 main phases:\n\n1. Prophase — chromosomes condense\n2. Metaphase — chromosomes line up\n3. Anaphase — chromosomes pulled apart\n4. Telophase — two new nuclei form\n\nWant me to quiz you on this?",
  "Help with an essay":"Of course! What's the topic and how long does it need to be? I can help you structure your argument, find evidence, and improve your writing.",
};

/* ══ SUBTOPIC / TEACHING HELPERS (from AkoroSimulator) ══════════════════════ */
export const SUBTOPIC_LIBRARY = {
  "water":          ["Evaporation","Condensation","Transpiration","Boiling Point","Melting Point","Water Cycle"],
  "photosynthesis": ["Light Reactions","Calvin Cycle","Chlorophyll","Glucose Production","Oxygen Release","Limiting Factors"],
  "forces":         ["Newton's 1st Law","Newton's 2nd Law","Newton's 3rd Law","Friction","Gravity","Pressure"],
  "electricity":    ["Current","Voltage","Resistance","Ohm's Law","Series Circuits","Parallel Circuits"],
  "cells":          ["Cell Structure","Cell Membrane","Nucleus","Mitosis","Cell Specialisation","Osmosis"],
  "algebra":        ["Variables & Expressions","Linear Equations","Inequalities","Simultaneous Equations","Quadratic Equations"],
  "fractions":      ["Equivalent Fractions","Adding Fractions","Multiplying Fractions","Dividing Fractions","Mixed Numbers"],
};
const SUBJECT_GENERIC = {
  "Science":  (t) => [`Introduction to ${t}`,`Properties of ${t}`,`Processes in ${t}`,`Applications of ${t}`,`${t} in the environment`],
  "Biology":  (t) => [`Structure: ${t}`,`Function: ${t}`,`${t} processes`,`${t} in humans`,`${t} and disease`],
  "Chemistry":(t) => [`${t} — structure`,`${t} — bonding`,`${t} — reactions`,`${t} — calculations`,`${t} — applications`],
  "Physics":  (t) => [`${t} — theory`,`${t} — equations`,`${t} — experiments`,`${t} — applications`,`${t} — calculations`],
  "Maths":    (t) => [`${t} — basics`,`${t} — formulas`,`${t} — worked examples`,`${t} — applications`,`${t} — exam technique`],
  "English":  (t) => [`${t} — overview`,`${t} — key themes`,`${t} — language features`,`${t} — analysis`,`${t} — essay writing`],
  "History":  (t) => [`Causes of ${t}`,`Key figures in ${t}`,`Events of ${t}`,`Consequences of ${t}`,`Legacy of ${t}`],
  "Geography":(t) => [`${t} — definition`,`${t} — causes`,`${t} — effects`,`${t} — case study`,`${t} — solutions`],
};
export function autoSubtopics(topic, subject) {
  const key = topic.toLowerCase().trim();
  if (SUBTOPIC_LIBRARY[key]) return SUBTOPIC_LIBRARY[key];
  const gen = SUBJECT_GENERIC[subject] || SUBJECT_GENERIC["Science"];
  return gen(topic);
}
export function autoObjectives(subtopic, topic) {
  return [
    `Define and explain ${subtopic} in the context of ${topic}`,
    `Identify the key causes and effects of ${subtopic}`,
    `Apply knowledge of ${subtopic} to real-world examples`,
  ];
}

/* Phase templates — mock fallback for teaching session messages */
export const PHASE_TEMPLATES = {
  phase1: (subtopic, topic, subject, ag) => [
    { role:"agent", agent:"nana", phase:"Phase 1 — Set the scene",
      text:`Alright! We're starting with ${subtopic} as part of ${topic}.\n\n${ag}, get ready to learn. Human — your job is to teach ${ag} about ${subtopic}. Start with what you already know about it.` },
    { role:"user",
      text:`OK ${ag}, so ${subtopic} is basically a process in ${subject} — it's about how something changes or moves in a specific way within the context of ${topic}.` },
    { role:"agent", agent:"student", phase:`${ag} · scanning knowledge base…`,
      text:`I'm processing that… I have very limited data on ${subtopic} right now. Could you explain what specifically changes? I want to understand the before and after.` },
  ],
  phase2: (subtopic, topic, subject, ag) => [
    { role:"agent", agent:"nana", phase:"Phase 2 — Must-know parts",
      text:`${ag} needs three things filled in:\n\n1. The definition of ${subtopic}\n2. What causes it\n3. What results from it\n\nHuman — walk ${ag} through each one.` },
    { role:"user",
      text:`Sure. ${subtopic} is defined as a process in ${subject} where specific inputs produce a measurable change. The main cause is when the required factor is present. The result is something you can observe directly.` },
    { role:"agent", agent:"student", phase:`${ag} · confidence: 41% → 63% ↑`,
      text:`I think I have it now. ${subtopic} is triggered by a primary condition, secondary factors control the rate, and the output type is consistent.` },
  ],
  assessment: (subtopic, nextSubtopic, ag, confidence) => [
    { role:"agent", agent:"prof", phase:`Assessment gate — ${subtopic}`,
      text:`Before ${ag} can move to ${nextSubtopic}, I need to verify ${subtopic} is solid.\n\nQuestion: What is the primary condition required for ${subtopic}?` },
    { role:"agent", agent:"student", phase:`${ag} · answering`,
      text:`The primary condition is the core driver that makes ${subtopic} possible at all. Without it, the process cannot occur.` },
    { role:"assess-result", subtopic, nextSubtopic, agentName: ag, confidence, passed: confidence >= 70 },
  ],
};

/* Mock decay session opening messages (used as fallback) */
export const MOCK_DECAY_MESSAGES = [
  { role:"agent", agent:"decay", phase:"Decay review · confidence dropped",
    text:"Hi Alex — Mitosis confidence has dropped significantly (31%). Let's do a targeted review.\n\nFirst: name the four phases of mitosis in order." },
  { role:"agent", agent:"decay", phase:"misconception flagged last session — targeting now",
    text:"Good — Prophase → Metaphase → Anaphase → Telophase.\n\nYou had this exact mix-up before. Memory trick: Telo = Greek for \"end\" — final stage, two nuclei form.\n\nWhat happens during Anaphase specifically?" },
  { role:"agent", agent:"decay", phase:"confidence: 31% → 52% ↑ · delta written",
    text:"Exactly right! Spindle fibres pull sister chromatids to opposite poles.\n\nKnowledge map updated. One more: Mitosis vs Meiosis — daughter cell count?" },
  { role:"agent", agent:"decay", phase:"misconception cleared · review complete",
    text:"Perfect. Mitosis = 2 identical diploid cells. Meiosis = 4 haploid gametes.\n\nNext review in 7 days. Keep it up! +80 XP" },
];
