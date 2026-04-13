# Overlay Component Keyword Mapping

This document maps keywords and phrases found in transcripts to their corresponding Remotion overlay components. Use this for both manual and agentic editing of transcript files to insert visual graphic overlays.

## Quick Usage

All overlays now require a `brand` prop to use the brand's font (Nunito) and colors. Add an overlay annotation after a segment in `transcript.doc.txt`:

```
[42]  We use Python for our backend
> Overlay LanguageOverlay brand={brand} language=python at="Python" duration=90
```

Or use in Remotion components with the brand from transcript.json:

```tsx
import { LanguageOverlay } from './overlays';

// Inside your component with access to brand
<LanguageOverlay
  brand={brand}
  language="python"
  startFrame={100}
  durationInFrames={90}
/>
```

## Component Reference

### 1. CodingOverlay (`CodingOverlay`)
Programming fundamentals and coding concepts.

| Keyword/Phrase | Component Prop |
|----------------|----------------|
| coding, code | `concept="coding"` |
| programming | `concept="programming"` |
| syntax | `concept="syntax"` |
| hello world | `concept="hello-world"` |
| if else, if/else, conditional | `concept="if-else"` |
| loops, for loop, while loop | `concept="loops"` |
| variables | `concept="variables"` |

---

### 2. EngineeringOverlay (`EngineeringOverlay`)
Engineering principles and concepts.

| Keyword/Phrase | Component Prop |
|----------------|----------------|
| engineering | `concept="engineering"` |
| system design | `concept="system-design"` |
| engineering mindset | `concept="mindset"` |
| vibe engineering | `concept="vibe-engineering"` |
| scalability, scale | `concept="scalability"` |
| production, production-ready | `concept="production"` |
| execution | `concept="execution"` |

---

### 3. LanguageOverlay (`LanguageOverlay`)
Programming languages.

| Keyword/Phrase | Component Prop |
|----------------|----------------|
| python | `language="python"` |
| javascript, js | `language="javascript"` |
| java | `language="java"` |
| php | `language="php"` |
| go, golang | `language="go"` |
| typescript, ts | `language="typescript"` |
| rust | `language="rust"` |
| c++, cpp | `language="cpp"` |
| binary, zeros and ones | `language="binary"` |

---

### 4. FrameworkOverlay (`FrameworkOverlay`)
Frameworks and tools.

| Keyword/Phrase | Component Prop |
|----------------|----------------|
| kubernetes, k8s | `framework="kubernetes"` |
| docker | `framework="docker"` |
| langchain | `framework="langchain"` |
| tensorflow | `framework="tensorflow"` |
| pytorch | `framework="pytorch"` |
| react | `framework="react"` |
| nextjs, next.js | `framework="nextjs"` |

---

### 5. RoleOverlay (`RoleOverlay`)
Job titles and roles.

| Keyword/Phrase | Component Prop |
|----------------|----------------|
| software engineer | `role="software-engineer"` |
| developer | `role="developer"` |
| coder | `role="coder"` |
| programmer | `role="programmer"` |
| junior developer, junior dev | `role="junior-developer"` |
| senior developer, senior dev | `role="senior-developer"` |
| devops, devops engineer | `role="devops-engineer"` |
| data center engineer | `role="data-center-engineer"` |
| machine learning engineer, ml engineer | `role="ml-engineer"` |
| ai app developer | `role="ai-app-developer"` |
| product engineer | `role="product-engineer"` |
| data engineer | `role="data-engineer"` |
| prompt engineer | `role="prompt-engineer"` |

---

### 6. PracticeOverlay (`PracticeOverlay`)
Best practices and standards.

| Keyword/Phrase | Component Prop |
|----------------|----------------|
| best practices | `practice="best-practices"` |
| standards | `practice="standards"` |
| fallback strategy | `practice="fallback-strategy"` |
| retry logic | `practice="retry-logic"` |
| lazy loading | `practice="lazy-loading"` |
| caching, cache | `practice="caching"` |
| api keys | `practice="api-keys"` |
| security | `practice="security"` |
| cybersecurity | `practice="cybersecurity"` |
| guardrails | `practice="guardrails"` |
| evaluation, eval | `practice="evaluation"` |
| explicit instructions | `practice="explicit-instructions"` |
| business acumen | `practice="business-acumen"` |

---

### 7. InfrastructureOverlay (`InfrastructureOverlay`)
Infrastructure and deployment concepts.

| Keyword/Phrase | Component Prop |
|----------------|----------------|
| containerization, containers | `concept="containerization"` |
| servers | `concept="servers"` |
| data center | `concept="data-center"` |
| deployment, deploy | `concept="deployment"` |
| tcp/ip | `concept="tcp-ip"` |
| http | `concept="http"` |
| https | `concept="https"` |
| api | `concept="api"` |
| pipeline | `concept="pipeline"` |
| scalability | `concept="scalability"` |
| optimization, optimize | `concept="optimization"` |
| ports | `concept="ports"` |
| cloud | `concept="cloud"` |

---

### 8. AIOverlay (`AIOverlay`)
AI and machine learning concepts.

| Keyword/Phrase | Component Prop |
|----------------|----------------|
| ai | `concept="ai"` |
| artificial intelligence | `concept="artificial-intelligence"` |
| ai assistant | `concept="ai-assistant"` |
| ai agent | `concept="ai-agent"` |
| prompt engineering | `concept="prompt-engineering"` |
| vibe coding | `concept="vibe-coding"` |
| model | `concept="model"` |
| llm, large language model | `concept="llm"` |
| agents | `concept="agents"` |
| api call | `concept="api-call"` |
| training, train | `concept="training"` |
| automation | `concept="automation"` |
| machine learning, ml | `concept="machine-learning"` |
| neural network | `concept="neural-network"` |

---

### 9. EducationOverlay (`EducationOverlay`)
Learning and education concepts.

| Keyword/Phrase | Component Prop |
|----------------|----------------|
| learning, learn | `concept="learning"` |
| fundamentals | `concept="fundamentals"` |
| curriculum | `concept="curriculum"` |
| workshop | `concept="workshop"` |
| hackathon | `concept="hackathon"` |
| mentor | `concept="mentor"` |
| training | `concept="training"` |
| teaching | `concept="teaching"` |
| education | `concept="education"` |
| skill | `concept="skill"` |
| mindset | `concept="mindset"` |
| discipline | `concept="discipline"` |

---

### 10. AwardsOverlay (`AwardsOverlay`)
Achievements and recognition.

| Keyword/Phrase | Component Prop |
|----------------|----------------|
| best podcast | `award="best-podcast"` |
| award winner, won, won award | `award="award-winner"` |
| recognition, recognized | `award="recognition"` |
| achievement | `award="achievement"` |
| milestone | `award="milestone"` |
| celebration, celebrate | `award="celebration"` |

---

## Common Phrases from Transcript

These phrases appear in the current transcript and map directly to overlays:

| Phrase in Transcript | Suggested Component |
|----------------------|---------------------|
| "best podcast award" | `AwardsOverlay award="best-podcast"` |
| "coding is still relevant" | `CodingOverlay concept="coding"` |
| "data center engineers" | `RoleOverlay role="data-center-engineer"` |
| "machine learning engineers" | `RoleOverlay role="ml-engineer"` |
| "DevOps engineers" | `RoleOverlay role="devops-engineer"` |
| "highest paying jobs" | `RoleOverlay` (various roles) |
| "system design" | `EngineeringOverlay concept="system-design"` |
| "product engineer" | `RoleOverlay role="product-engineer"` |
| "vibe coding" | `AIOverlay concept="vibe-coding"` |
| "prompt engineering" | `AIOverlay concept="prompt-engineering"` |
| "AI agents" | `AIOverlay concept="agents"` |
| "best practices" | `PracticeOverlay practice="best-practices"` |
| "security vulnerabilities" | `PracticeOverlay practice="cybersecurity"` |
| "API keys" | `PracticeOverlay practice="api-keys"` |
| "TCP/IP" | `InfrastructureOverlay concept="tcp-ip"` |
| "HTTP and HTTPS" | `InfrastructureOverlay concept="https"` |
| "containerization" | `InfrastructureOverlay concept="containerization"` |
| "Kubernetes" | `FrameworkOverlay framework="kubernetes"` |
| "retry logic" | `PracticeOverlay practice="retry-logic"` |
| "fallback strategy" | `PracticeOverlay practice="fallback-strategy"` |
| "lazy loading" | `PracticeOverlay practice="lazy-loading"` |
| "caching" | `PracticeOverlay practice="caching"` |
| "engineering mindset" | `EngineeringOverlay concept="mindset"` |
| "content creation" | `EducationOverlay concept="learning"` |
| "AI app developers" | `RoleOverlay role="ai-app-developer"` |
| "Python" | `LanguageOverlay language="python"` |
| "JavaScript" | `LanguageOverlay language="javascript"` |
| "agent development kits" | `AIOverlay concept="agents"` |
| "LangChain" | `FrameworkOverlay framework="langchain"` |
| "if-else" | `CodingOverlay concept="if-else"` |
| "loops" | `CodingOverlay concept="loops"` |
| "fundamental mindsets" | `EducationOverlay concept="fundamentals"` |
| "explicit instructions" | `PracticeOverlay practice="explicit-instructions"` |

---

## Usage in Transcript Editing

### Manual Editing

Add overlay annotations after relevant segments:

```
[123]  We use containerization with Docker
> Overlay InfrastructureOverlay concept=containerization at="containerization" duration=90
```

### Agentic Editing

AI agents should:

1. Scan the transcript for keywords from the mapping above
2. When a keyword match is found, check if an overlay would enhance the moment
3. Insert an overlay annotation on the line following the segment
4. Use `at="word"` to time the overlay with specific spoken words
5. Use `duration=N` where N is frames (at 60fps, 90 frames = 1.5 seconds)

### Timing Guidelines

- **Quick mentions**: 60 frames (1 second)
- **Standard concepts**: 90 frames (1.5 seconds) 
- **Key emphasis moments**: 120-150 frames (2-2.5 seconds)
- **Multiple related concepts**: Space 30 frames apart

### Position Guidelines

- Default: `position="center"`
- When speaker is on left: `position="top-right"` or `position="bottom-right"`
- When speaker is on right: `position="top-left"` or `position="bottom-left"`
- For awards/achievements: `position="center"`

---

## Import Reference

All overlays can be imported from:

```typescript
import {
  CodingOverlay,
  EngineeringOverlay,
  LanguageOverlay,
  FrameworkOverlay,
  RoleOverlay,
  PracticeOverlay,
  InfrastructureOverlay,
  AIOverlay,
  EducationOverlay,
  AwardsOverlay,
} from './overlays';
```
