# PixoraPro - AI Agent-Powered Image & Canvas Editor

<div align="center">

  ![Pixora AI Editor Overview](docs/assets/hero-banner.jpg)

  **Next-Generation Canvas & Image Editor Powered by Multi-Layer Autonomous AI Agents**

  [![Next.js](https://img.shields.io/badge/Next.js-16.2-black?style=for-the-badge&logo=nextdotjs)](https://nextjs.org/)
  [![React](https://img.shields.io/badge/React-19.2-61DAFB?style=for-the-badge&logo=react)](https://react.dev/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
  [![Fabric.js](https://img.shields.io/badge/Fabric.js-7.4-FF6B6B?style=for-the-badge)](https://fabricjs.com/)
  [![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?style=for-the-badge&logo=tailwindcss)](https://tailwindcss.com/)
  [![Google Gemini](https://img.shields.io/badge/Google_Gemini-Agent_Ready-8E75FF?style=for-the-badge&logo=google-gemini)](https://ai.google.dev/)

</div>

---

## 🌟 Overview

**Pixora (Vibecraft Editor)** is a web-based vector and raster canvas editing platform designed for modern product marketing, advertisement creation, and graphic design.

What makes Pixora unique is its **integrated, multi-layer AI Agent**. Instead of simple text-to-image prompts or isolated filters, Pixora's agent acts as a co-designer: it inspects your canvas layer tree, sees high-res visual screenshots, and executes structured tool calls in real time to perform complex multi-step design workflows directly on your canvas.

---

## 💰 Model Cost Comparison

Each supported model, its output for the same prompt, and the cost of a single agent request:

| Model | Output | Cost / request |
| :---: | :---: | :---: |
| **GPT 5.6 Luna** | ![GPT 5.6 Luna](docs/assets/model-gpt-luna.png) | $0.02 |
| **GPT 5.6 Terra** | ![GPT 5.6 Terra](docs/assets/model-gpt-terra.png) | $0.06 |
| **GPT 5.6 Sol** | ![GPT 5.6 Sol](docs/assets/model-gpt-sol.png) | $0.13 |
| **Gemini 3.8** | ![Gemini 3.8](docs/assets/model-gemini-3-8.png) | $0.05 |
| **Gemini 3.5 Flash Lite** | ![Gemini 3.5 Flash Lite](docs/assets/model-gemini-3-5-flash-lite.png) | < $0.01 |

---

## 📸 Visual Showcase & Workflow

### 1. From Raw Product Photo to High-Converting Ad

Give the AI Assistant a single natural language instruction:
> *"I'm trying to sell this product so, create a good ad for it"*

| 1. Initial Raw Image Prompt | 2. Real-Time AI Agent Execution | 3. Finished Layered Design |
| :---: | :---: | :---: |
| ![Initial State](docs/assets/hero-editor-prompt.png) | ![Agent Building Ad](docs/assets/agent-building-ad.png) | ![Finished Canvas](docs/assets/agent-finished-ad.png) |
| *User uploads raw product photo and enters natural language goal.* | *Agent removes background, adds background cards, typography, badges & shadows.* | *Final editable layout with full layer stack and fine-grained controls.* |

---

### 2. High-Resolution Export Gallery

The agent automatically formats typography, colors, CTA buttons, and product placement tailored to specific branding requirements and languages (including RTL Arabic layout support):

<div align="center">

| Organic Honey Product Ad | Herbal Tea Campaign (Arabic RTL) | Smartwatch Product Ad (Dark Mode) |
| :---: | :---: | :---: |
| ![Honey Ad Export](docs/assets/export-honey-ad.png) | ![Herbal Tea Export](docs/assets/export-herbal-tea.png) | ![Smartwatch Export](docs/assets/export-smart-watch.png) |
| *Clean Minimalist Aesthetic* | *RTL Typography & CTA Buttons* | *Dark Mode & Vibrant Badges* |

</div>

---

## 🤖 AI Agent Operations & Toolset

Pixora's agent operates via a neutral protocol behind an `AgentTransport` interface. It executes over 20+ specialized tool operations directly on the Fabric.js canvas:

```
                  ┌──────────────────────────────────────────────┐
                  │              User Prompt                     │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │    AI Agent Engine (Gemini / Claude)          │
                  │    - Inspects Canvas Layer State             │
                  │    - Inspects Visual Canvas Screenshots       │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
     ┌────────────────────────────────────────────────────────────────────────┐
     │                    Structured Canvas Tool Execution                    │
     ├───────────────────────┬────────────────────────┬───────────────────────┤
     │  Layer & Layout       │  Object Manipulation   │  Design & Styling     │
     │  - set_artboard       │  - remove_background   │  - add_text           │
     │  - place_in_card      │  - crop_image          │  - add_shape          │
     │  - align_layer        │  - adjust_image        │  - set_gradient       │
     │  - distribute_layers  │  - set_image_fit       │  - set_properties     │
     │  - arrange_grid       │  - duplicate_layer     │  - sample_color       │
     │  - move_layer (z-index)│ - delete_layer        │  - group / ungroup    │
     └───────────────────────┴────────────────────────┴───────────────────────┘
```

### Complete List of Agent Capabilities

- ✂️ **Client-Side AI Background Removal**: Isolates product subjects locally without external latency.
- 📐 **Artboard & Preset Management**: Dynamically sets custom canvas sizes (e.g. 1024x1024, Instagram Story, Social Banners) and background fills.
- 🎨 **Smart Background Card Framing**: Places products inside padded background cards with soft dropshadows (`place_in_card`).
- ✍️ **Multi-Lingual Typography & Alignment**: Adds styled headlines, subheaders, badges, and call-to-action (CTA) buttons with automatic RTL/LTR font alignment.
- 🎚️ **Image Adjustments**: Tweaks brightness, contrast, saturation, hue rotation, and blur filters.
- 🏗️ **Multi-Layer Z-Index & Alignment**: Aligns objects (left, center, top, bottom), distributes spacing evenly, groups elements, and re-orders z-index layers.
- 📸 **Visual Vision Feedback**: Uses live canvas screenshots to refine visual aesthetics turn-by-turn.
- ↩️ **Atomic Batch Undo**: Groups all agent steps per turn into a single undo/redo transaction.

---

## 🛠️ Editor UI Features

![Editor Workspace Overview](docs/assets/editor-ui-overview.png)

- **Interactive Canvas Engine**: Built on Fabric.js v7 with smooth object transformation handles, rotation, and selection.
- **Layer Panel**: Drag-and-drop layer reordering, lock, hide/show toggle, and layer naming.
- **Properties Sidebar**: Real-time property modification for text fonts, colors, opacity, border radius, stroke, shadow, and image filters.
- **Drawing Tools**: Freehand brush, pencil, eraser, shapes (rectangles, circles, stars, polygons), and text tools.
- **Project Export**: High-DPI PNG export and JSON canvas state saving.

---

## 🚀 Quick Start & Installation

### 1. Prerequisites
- **Node.js**: `v18.0.0` or higher
- **npm** (or `yarn` / `pnpm` / `bun`)

### 2. Clone & Install
```bash
git clone https://github.com/Amine136/PixoraPro.git
cd PixoraPro
npm install
```

### 3. Environment Configuration
No AI provider key belongs in the environment. Each user pastes their own Gemini
key in the Assistant panel (key icon); it is saved in that browser's
`localStorage` and sent **only to Google, from the browser** — it never reaches
this app's server.

The one server-side secret is the background-removal service, which is proxied so
its token stays off the client:

```bash
cp .env.example .env.local
```

```env
# Server-only — NOT NEXT_PUBLIC_, or the token would be inlined into the
# client bundle and readable by every visitor.
BG_REMOVE_URL=https://your-cloud-run-service.run.app/api/remove-bg
BG_REMOVE_TOKEN=your_bg_remove_token_here
```

Background removal is optional: without it, the editor falls back to
client-side flood-fill removal, which handles flat backgrounds only.

### 4. Run Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser, then open
the Assistant panel, paste a [Google AI Studio](https://aistudio.google.com/apikey)
key and pick a model to enable AI edits.

---

## 📁 Project Architecture

```
PixoraPro/
├── docs/
│   ├── assets/                   # Documentation screenshots & exports
│   ├── agent-mode-plan.md        # AI Agent architecture specification
│   ├── agent-gateway.md         # Optional gateway protocol guide
│   └── agent-eval.md            # Benchmark evaluation suite
├── src/
│   ├── app/
│   │   ├── api/remove-bg/        # Cloud Run proxy (keeps the token server-side)
│   │   └── page.tsx              # Main editor application page
│   ├── components/
│   │   └── editor/               # Canvas, AgentPanel, AiSettingsPanel, TopBar
│   └── lib/
│       ├── agent/                # Protocol, tools, settings, browser providers
│       └── editor/               # Fabric.js hook (useEditor) & state handlers
├── .env.example                  # Environment configuration template
└── README.md                     # Main repository documentation
```

---

## 📄 License

Private repository - All rights reserved.
