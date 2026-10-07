Yes. The cleanest way is to make points and rubric first-class fields on an assignment, then let AI suggest how to split the total marks across questions based on difficulty, cognitive level, and comprehensiveness. The instructor should always be able to override.

Suggested fields to add

Assignment-level fields

· total_points / total_marks: e.g. 10, 20, 50, 100
· grading_mode: Points only | Rubric only | Points + Rubric
· passing_marks: optional
· rubric: list of criteria with weights or max points
· ai_auto_allocate_points: on/off
· ai_auto_grade: on/off
· allow_instructor_override: on/off

Question-level fields

· question_text
· question_type: MCQ, short answer, essay, coding, diagram, etc.
· max_points
· difficulty: Easy / Medium / Hard
· cognitive_level: Recall / Apply / Analyze / Evaluate / Create
· comprehensiveness: Low / Medium / High
· ai_weight: optional manual weight
· ai_suggested_points: auto-generated

AI point allocation logic
A simple formula:

```text
weight = difficulty_score × cognitive_score × comprehensiveness_score × time_factor
question_points = round(total_points × weight / sum(all weights))
```

Example: a 10-point quiz with 4 questions might split as 2, 3, 2, 3 depending on difficulty.

---

Sample assignment 1: 10-point quiz

Title: Introduction to Photosynthesis
Total points: 10
Grading mode: Points + Rubric

Question Type Skill Difficulty AI-suggested points
Q1. What gas do plants absorb during photosynthesis? MCQ Recall Easy 2
Q2. Explain the role of chlorophyll. Short answer Understand Medium 3
Q3. Label the parts of a chloroplast. Diagram Apply Medium 2
Q4. Predict what happens if a plant is kept in darkness for 48 hours. Short answer Analyze Hard 3

Rubric

· Correctness: 70%
· Completeness: 20%
· Clarity: 10%

AI grading note: AI can award partial marks for Q2 and Q4 based on how many key concepts are mentioned.

---

Sample assignment 2: 20-point essay

Title: Causes of World War I
Total points: 20
Grading mode: Rubric only

Prompt: Evaluate the main causes of World War I. Which cause was most significant?

Rubric criterion Points
Thesis and argument 3
Use of evidence 6
Analysis and reasoning 6
Organization 3
Grammar and style 2
Total 20

AI auto-marking: AI can break the essay into sections and assign marks per criterion. It should give feedback like: “Strong evidence, but analysis of nationalism is underdeveloped.”

---

Sample assignment 3: 50-point coding assignment

Title: Build a To-Do List REST API
Total points: 50
Grading mode: Points + Rubric

Task Points
Project setup and dependencies 5
Create endpoint 5
Read endpoints 5
Update endpoint 5
Delete endpoint 5
Input validation and error handling 10
Automated tests 10
Documentation / README 5
Total 50

Rubric

· Functionality: 40%
· Code quality: 20%
· Testing: 20%
· Edge cases: 10%
· Documentation: 10%

AI grading note: AI can run tests, inspect code structure, and suggest marks per endpoint. Instructor approves final score.

---

Sample assignment 4: 100-point research project

Title: Climate Change Research Project
Total points: 100
Grading mode: Points + Rubric

Section Points
Abstract 5
Introduction and problem statement 15
Literature review 20
Methodology 15
Results / findings 15
Discussion and conclusion 20
References and formatting 10
Total 100

AI point allocation: AI can assign more weight to literature review and discussion because they require higher comprehension, synthesis, and critical thinking.

---

Example JSON structure

```json
{
  "title": "Photosynthesis Quiz",
  "total_points": 10,
  "grading_mode": "points+rubric",
  "ai_auto_allocate_points": true,
  "rubric": [
    { "criterion": "Correctness", "weight": 70 },
    { "criterion": "Completeness", "weight": 20 },
    { "criterion": "Clarity", "weight": 10 }
  ],
  "questions": [
    {
      "text": "What gas do plants absorb during photosynthesis?",
      "type": "MCQ",
      "difficulty": "Easy",
      "cognitive_level": "Recall",
      "comprehensiveness": "Low",
      "max_points": 2
    },
    {
      "text": "Explain the role of chlorophyll.",
      "type": "Short answer",
      "difficulty": "Medium",
      "cognitive_level": "Understand",
      "comprehensiveness": "Medium",
      "max_points": 3
    }
  ]
}
```

If you tell me the subject, grade level, and assignment type, I can generate a full set of sample assignments with exact rubrics, point splits, and AI marking instructions.
