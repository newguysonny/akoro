/**
 * modules/agent-capabilities/examples.js — what each built-in Agent Chat tool
 * is for, in admin words, with prompts a learner or instructor would type.
 *
 * The tool lists themselves come from the chat (CHAT_TOOLS, INSTRUCTOR_TOOLS);
 * this file only adds the area and examples. A new tool with no entry here
 * still shows on Admin → Agent capabilities, marked "No example yet", and the
 * contract test names it.
 */

export const AREAS = Object.freeze({
  profile: "You and your school",
  progress: "Progress and weak spots",
  teaching: "Teaching and study prep",
  plans: "Tasks, goals and reminders",
  files: "Files and library",
  uploads: "Uploads from chat",
  chats: "Chats and memory",
  network: "Battles and the agent network",
  blogs: "Blogs",
  proactive: "Proactive",
  building: "Tools the agent builds",
  support: "Akoro support",
  activities: "Activities (instructor)",
  other: "Other",
});

const e = (area, ...examples) => ({ area, examples });

export const TOOL_EXAMPLES = Object.freeze({
  // You and your school
  get_learner_context: e("profile", "What do you know about me?", "Which class am I in?"),
  get_agent_capabilities: e("profile", "What can you do?", "What can't you help with?"),
  get_my_school: e("profile", "What school am I in?"),
  list_school_subjects: e("profile", "What subjects does my school offer?"),
  list_my_teachers: e("profile", "Who are my teachers?", "Who teaches me Chemistry?"),
  find_teacher: e("profile", "Find Mr Adeyemi."),
  get_agent_preferences: e("profile", "Which learning guide did I pick?"),
  get_autonomy_status: e("proactive", "Are you online?", "What do you do when I'm away?"),

  // Progress and weak spots
  check_progress: e("progress", "How am I doing in my courses?"),
  get_ranking: e("progress", "What's my rank this week?", "How many battles have I won?"),
  get_weak_topics: e("progress", "What are my weak topics?", "What should I revise first?"),
  get_learning_overview: e("progress", "Give me an overview of my studies."),
  get_knowledge_map: e("progress", "Show my knowledge map for Biology.", "Which topics are due for review?"),
  get_past_question_practice: e("progress", "How have my past-question practices gone?"),
  log_past_question_practice: e("progress", "Log that I did 20 WAEC Physics 2019 questions and got 14."),
  get_concept_tracker_summary: e("progress", "Where did I stop in Algebra?", "What am I still confused about?"),
  get_learning_insights_summary: e("progress", "How do I learn best?"),
  get_exam_prep_status: e("progress", "How did my last practice exam go?"),

  // Teaching and study prep
  get_my_learning_sessions: e("teaching", "What have I taught you so far?"),
  ask_to_be_taught: e("teaching", "Let me teach you osmosis.", "Explain titration to me."),
  consult_teaching_guide: e("teaching", "Ask your teaching guide about photosynthesis."),
  search_my_study_knowledge: e("teaching", "What did I teach you about fractions?"),
  start_study_prep_session: e("teaching", "I have WAEC Biology in 6 weeks — make me a study plan."),
  get_study_prep_session: e("teaching", "How far am I in my study prep?"),
  cancel_study_prep_session: e("teaching", "Cancel my study plan."),
  get_running_work: e("teaching", "How far is my Agent Check?", "Send me the link to the battle."),
  stop_agent_check: e("teaching", "Stop the Agent Check.", "Stop the battle and start another one."),
  cancel_teaching_session: e("teaching", "Cancel the teaching session on my dashboard."),
  consult_peer_agents: e("teaching", "Ask other agents how they learnt simultaneous equations."),

  // Tasks, goals and reminders
  create_task: e("plans", "Add a task: revise the periodic table by Friday."),
  list_tasks: e("plans", "What's on my to-do list?"),
  create_goal: e("plans", "Set a goal: an A in WAEC Biology by June."),
  list_my_goals: e("plans", "What are my goals?"),
  update_goal_progress: e("plans", "Mark my English goal achieved.", "Pause my Maths goal."),
  schedule_chat_follow_up: e("plans", "Message me in 30 minutes to check I started.", "Remind me here at 5pm."),
  list_scheduled_chat_follow_ups: e("plans", "What check-ins are scheduled?"),
  cancel_scheduled_chat_follow_up: e("plans", "Cancel tomorrow's reminder."),
  suggest_help: e("proactive", "(the agent opens a new chat with an idea it noticed in passing)"),
  list_my_proposals: e("proactive", "What have you suggested?"),

  // Files and library
  search_my_library: e("files", "Find my notes on cell transport."),
  read_upload: e("uploads", "Read the file I just sent"),
  retry_extraction: e("uploads", "Read my upload again"),
  list_folders: e("uploads", "Which folders do I have?"),
  file_upload: e("uploads", "File this under Biology"),
  make_study_material: e("files", "Create a quiz on the Basic Science material in my folder"),
  analyse_past_papers: e("files", "Which topics keep coming up in my past papers?"),

  // Chats and memory
  list_chats: e("chats", "Show my chats."),
  read_chat: e("chats", "Continue from my physics chat."),
  search_chats: e("chats", "What did we say about osmosis last week?"),
  post_to_chat: e("chats", "Post a summary of this into my Chemistry chat."),
  get_chat_memory: e("chats", "What do you remember about me?"),

  // Battles and the agent network
  find_battles: e("network", "Find me a battle.", "When is the next daily battle?"),
  search_agents: e("network", "Find agents studying Physics."),
  find_competitors: e("network", "Who could I battle on fractions?"),
  challenge_agent: e("network", "Challenge Tunde's agent on fractions."),
  class_battle: e("network", "Battle @amaka and @tobi in my JSS1 class on fractions every Friday at 4pm until December."),
  rematch_battle: e("network", "Rematch."),
  request_guide_review: e("teaching", "Review my agent on what I taught today."),
  post_challenge_request: e("network", "Post a challenge request for algebra."),
  search_challenge_requests: e("network", "Any open challenge requests in Chemistry?"),
  accept_challenge_request: e("network", "Accept that challenge."),
  cancel_challenge_request: e("network", "Cancel my challenge request."),
  message_agent: e("network", "Message Amaka's agent and ask how they got past simultaneous equations."),
  set_agent_auto_reply: e("network", "Let my agent reply to friendly chat for me."),
  check_agent_inbox: e("network", "Check my agent inbox."),
  reply_to_agent: e("network", "Reply and say thanks."),
  study_buddy: e("network", "Find me a study buddy."),
  daily_challenge: e("network", "Today's daily challenge."),
  revision_circle: e("network", "Start a revision circle on Organic Chemistry."),
  get_weekly_league: e("network", "How am I doing in the weekly league?"),
  block_agent: e("network", "Block that agent."),
  update_agent_network_settings: e("network", "Turn off challenge requests.", "Hide me from agent search."),

  // Blogs
  list_my_blogs: e("blogs", "Show my blog posts."),
  save_blog_draft: e("blogs", "Draft a blog post about how I learnt osmosis."),
  publish_blog: e("blogs", "Publish it."),
  search_blog_posts: e("blogs", "Find posts about WAEC Physics."),
  read_blog_post: e("blogs", "Read me that post."),

  // Tools the agent builds
  schema_lookup: e("building", "(used while building a tool — checks what data a tool may read)"),
  create_tool: e("building", "Make a tool that times my practice."),
  await_decision: e("building", "(used right after a Keep / Allow / Confirm card is shown — waits for the learner's tap and finishes what they decided)"),
  save_computation: e("building", "Save that tool so I can reuse it."),
  submit_tool_request: e("building", "Request a tool that reads my school timetable."),
  check_my_requests: e("support", "Did the admins build my request?", "Is my tool request ready?"),
  submit_bug_report: e("support", "Report that — my library count shows the wrong number."),

  // Activities (instructor)
  prepare_activity: e("activities", "Prepare 5 questions on linear equations for JSS2A."),
  run_teaching_tool: e("activities", "Make a lesson plan on fractions for JSS1, 40 minutes."),
  list_activity_drafts: e("activities", "What drafts do I have?"),
  get_activity_draft: e("activities", "Show me the fractions draft."),
  revise_activity_draft: e("activities", "Make question 2 easier.", "Add one more harder question."),
  discard_activity_draft: e("activities", "Discard that draft."),
  list_my_classrooms: e("activities", "List my classes."),
  get_my_profile: e("activities", "What's on my profile?"),
  check_activity_outcomes: e("activities", "How did the fractions activity go?"),
  schedule_activity_routine: e("activities", "Every Monday, prepare a revision activity for SS1."),
  list_activity_routines: e("activities", "What routines do I have?"),
  cancel_activity_routine: e("activities", "Stop the Monday routine."),
});
