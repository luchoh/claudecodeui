<div align="center">
  <img src="public/logo.svg" alt="Claude Code UI" width="64" height="64">
  <h1>Cloud CLI (aka Claude Code UI)</h1>
</div>

A desktop and mobile UI for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Cursor CLI](https://docs.cursor.com/en/cli/overview) and [Codex](https://developers.openai.com/codex). Use it locally or remotely to view your active projects and sessions and make changes from anywhere (mobile or desktop).

[English](./README.md) | [中文](./README.zh-CN.md)

## Screenshots

<div align="center">

<table>
<tr>
<td align="center">
<h3>Desktop View</h3>
<img src="public/screenshots/desktop-main.png" alt="Desktop Interface" width="400">
<br>
<em>Main interface showing project overview and chat</em>
</td>
<td align="center">
<h3>Mobile Experience</h3>
<img src="public/screenshots/mobile-chat.png" alt="Mobile Interface" width="250">
<br>
<em>Responsive mobile design with touch navigation</em>
</td>
</tr>
<tr>
<td align="center" colspan="2">
<h3>CLI Selection</h3>
<img src="public/screenshots/cli-selection.png" alt="CLI Selection" width="400">
<br>
<em>Select between Claude Code, Cursor CLI and Codex</em>
</td>
</tr>
</table>

</div>

## Features

- **Responsive Design** - Works seamlessly across desktop, tablet, and mobile
- **Interactive Chat Interface** - Built-in chat for communication with Claude Code, Cursor, or Codex
- **Integrated Shell Terminal** - Direct CLI access through built-in shell functionality
- **File Explorer** - Interactive file tree with syntax highlighting and live editing
- **Session Management** - Resume conversations, manage multiple sessions, and track history
- **TaskMaster AI Integration** *(Optional)* - Advanced project management with AI-powered task planning
- **Model Compatibility** - Works with Claude Sonnet 4.5, Opus 4.5, and GPT-5.2
- **Security Hardened** - JWT authentication, CSRF protection, rate limiting, and CSP headers

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) v20 or higher
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and configured, and/or
- [Cursor CLI](https://docs.cursor.com/en/cli/overview) installed and configured, and/or
- [Codex](https://developers.openai.com/codex) installed and configured

### One-click Operation (Recommended)

No installation required:

```bash
npx @siteboon/claude-code-ui
```

The server will start at `http://localhost:3001` (or your configured PORT).

### Global Installation (For Regular Use)

For frequent use, install globally:

```bash
npm install -g @siteboon/claude-code-ui
```

Then start with:

```bash
claude-code-ui
```

### CLI Usage

After global installation, you have access to both `claude-code-ui` and `cloudcli` commands:

| Command / Option | Short | Description |
|------------------|-------|-------------|
| `cloudcli` or `claude-code-ui` | | Start the server (default) |
| `cloudcli start` | | Start the server explicitly |
| `cloudcli status` | | Show configuration and data locations |
| `cloudcli help` | | Show help information |
| `cloudcli version` | | Show version information |
| `--port <port>` | `-p` | Set server port (default: 3001) |
| `--database-path <path>` | | Set custom database location |

**Examples:**
```bash
cloudcli                     # Start with defaults
cloudcli -p 8080             # Start on custom port
cloudcli status              # Show current configuration
```

### Run as Background Service (Recommended for Production)

For production use, run as a background service using PM2:

#### Install PM2

```bash
npm install -g pm2
```

#### Start as Background Service

```bash
# Start the server in background
pm2 start claude-code-ui --name "claude-code-ui"

# Or using the shorter alias
pm2 start cloudcli --name "claude-code-ui"

# Start on a custom port
pm2 start cloudcli --name "claude-code-ui" -- --port 8080
```

#### Auto-Start on System Boot

```bash
# Generate startup script for your platform
pm2 startup

# Save current process list
pm2 save
```

### Local Development

This project uses [devenv](https://devenv.sh/) for development environment management.

#### Prerequisites

- [Nix](https://nixos.org/download.html) with flakes enabled
- [devenv](https://devenv.sh/getting-started/)

#### Setup

1. **Clone the repository:**
```bash
git clone https://github.com/nicepkg/cloudcli.git
cd cloudcli
```

2. **Enter the development shell:**
```bash
devenv shell
```

3. **First-time setup** (creates `.env.dev` with generated JWT secret):
```bash
setup-env
```

4. **Start the application:**
```bash
devenv up
```

This starts both the Express backend (default port 3001) and Vite dev server (default port 5173).

#### Other Commands

```bash
devenv up server         # Run backend only
devenv up client         # Run Vite dev server only
npm run build            # Build for production
npm run typecheck        # TypeScript type checking
npm test                 # Run tests
```

> **Note:** This project uses `npm-shrinkwrap.json` for deterministic dependency installation. The devenv shell automatically runs `npm install` if `node_modules` doesn't exist.

## First-Time Setup

When you first access Claude Code UI, you'll need to create an account:

1. **Open the app** in your browser (e.g., `http://localhost:3003`)
2. **Create your account** - Enter a username (3+ chars) and password (6+ chars)
3. **Sign in** - Use your credentials to access the app

**Security notes:**
- This is a **single-user system** - only one account can be created
- After the first account is created, registration is permanently disabled
- The `/api/auth/register` endpoint returns 403 for all subsequent attempts

To reset and create a new account (development only):
```bash
sqlite3 server/database/auth.db "DELETE FROM users; DELETE FROM refresh_tokens;"
```

## Security & Tools Configuration

**Important**: All Claude Code tools are **disabled by default**. This prevents potentially harmful operations from running automatically.

### Security Features

This application includes comprehensive security hardening:

- **Authentication** - JWT-based authentication with secure httpOnly cookies
- **CSRF Protection** - Double-submit cookie pattern for state-changing requests
- **Rate Limiting** - Configurable limits on API endpoints
- **Content Security Policy** - Strict CSP headers in production
- **Credential Storage** - Secure keychain storage (no plaintext fallback)
- **Input Validation** - Server-side validation with Zod schemas

### Network Access Configuration

By default, the server binds to `127.0.0.1` (localhost only). To access from other devices:

1. **Edit `.env.dev`** (development) or `.env` (production):
```bash
# Bind to all interfaces
BIND_HOST=0.0.0.0

# Allow CORS from your access URLs
ALLOWED_ORIGINS=http://localhost:3003,http://YOUR_LAN_IP:3003
```

2. **Restart the server** for changes to take effect

**For VPN/WireGuard access**: Add your VPN subnet IPs to `ALLOWED_ORIGINS`

### Enabling Tools

To use Claude Code's full functionality:

1. **Open Tools Settings** - Click the gear icon in the sidebar
2. **Enable Selectively** - Turn on only the tools you need
3. **Apply Settings** - Your preferences are saved locally

<div align="center">

![Tools Settings Modal](public/screenshots/tools-modal.png)
*Tools Settings interface - enable only what you need*

</div>

**Recommended approach**: Start with basic tools enabled and add more as needed.

## TaskMaster AI Integration *(Optional)*

Claude Code UI supports **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** integration for advanced project management.

Features:
- AI-powered task generation from PRDs (Product Requirements Documents)
- Smart task breakdown and dependency management
- Visual task boards and progress tracking

**Setup**: Visit the [TaskMaster AI repository](https://github.com/eyaltoledano/claude-task-master) for installation instructions. Enable it from Settings after installation.

## Usage Guide

### Core Features

#### Project Management
- Automatically discovers Claude Code, Cursor or Codex sessions
- **Project Actions** - Rename, delete, and organize projects
- **Smart Navigation** - Quick access to recent projects and sessions
- **MCP support** - Add your own MCP servers through the UI

#### Chat Interface
- **Responsive Chat or CLI** - Use the adapted chat interface or shell button to connect to your CLI
- **Real-time Communication** - Stream responses via WebSocket connection
- **Session Management** - Resume previous conversations or start fresh
- **Message History** - Complete conversation history with timestamps
- **Multi-format Support** - Text, code blocks, and file references

#### File Explorer & Editor
- **Interactive File Tree** - Browse project structure with expand/collapse navigation
- **Live File Editing** - Read, modify, and save files directly
- **Syntax Highlighting** - Support for multiple programming languages
- **File Operations** - Create, rename, delete files and directories

#### TaskMaster AI Integration *(Optional)*
- **Visual Task Board** - Kanban-style interface for managing tasks
- **PRD Parser** - Parse Product Requirements Documents into structured tasks
- **Progress Tracking** - Real-time status updates and completion tracking

#### Session Management
- **Session Persistence** - All conversations automatically saved
- **Session Organization** - Group sessions by project and timestamp
- **Session Actions** - Rename, delete, and export conversation history
- **Cross-device Sync** - Access sessions from any device

### Mobile App
- **Responsive Design** - Optimized for all screen sizes
- **Touch-friendly Interface** - Swipe gestures and touch navigation
- **Mobile Navigation** - Bottom tab bar for easy thumb navigation
- **Adaptive Layout** - Collapsible sidebar and smart content prioritization
- **Add to Home Screen** - Install as a PWA for native app experience

## Architecture

### System Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │  Agent          │
│   (React/Vite)  │◄──►│ (Express/WS)    │◄──►│  Integration    │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Backend (Node.js + Express)
- **Express Server** - RESTful API with static file serving
- **WebSocket Server** - Real-time communication for chats and project refresh
- **Agent Integration** - Claude Code / Cursor CLI / Codex process management
- **File System API** - Project file browser

### Frontend (React + Vite)
- **React 18** - Modern component architecture with hooks
- **CodeMirror** - Advanced code editor with syntax highlighting

## Contributing

We welcome contributions! Please follow these guidelines:

### Getting Started
1. **Fork** the repository
2. **Clone** your fork
3. **Install** dependencies: `npm ci`
4. **Create** a feature branch: `git checkout -b feature/amazing-feature`

### Development Process
1. **Make your changes** following existing code style
2. **Test thoroughly** - ensure all features work correctly
3. **Run quality checks**: `npm run typecheck`
4. **Run tests**: `npm test`
5. **Commit** with descriptive messages following [Conventional Commits](https://conventionalcommits.org/)
6. **Push** to your branch
7. **Submit** a Pull Request with:
   - Clear description of changes
   - Screenshots for UI changes
   - Test results if applicable

### What to Contribute
- **Bug fixes** - Help us improve stability
- **New features** - Enhance functionality (discuss in issues first)
- **Documentation** - Improve guides and API docs
- **UI/UX improvements** - Better user experience
- **Performance optimizations** - Make it faster

## Troubleshooting

### Common Issues & Solutions

#### "No Claude projects found"
**Problem**: The UI shows no projects or empty project list
**Solutions**:
- Ensure [Claude Code](https://docs.anthropic.com/en/docs/claude-code) is properly installed
- Run `claude` command in at least one project directory to initialize
- Verify `~/.claude/projects/` directory exists and has proper permissions

#### File Explorer Issues
**Problem**: Files not loading, permission errors, empty directories
**Solutions**:
- Check project directory permissions (`ls -la` in terminal)
- Verify the project path exists and is accessible
- Review server console logs for detailed error messages
- Ensure you're not trying to access system directories outside project scope

## License

GNU General Public License v3.0 - see [LICENSE](LICENSE) file for details.

This project is open source and free to use, modify, and distribute under the GPL v3 license.

## Acknowledgments

### Built With
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic's official CLI
- **[Cursor CLI](https://docs.cursor.com/en/cli/overview)** - Cursor's official CLI
- **[Codex](https://developers.openai.com/codex)** - OpenAI Codex
- **[React](https://react.dev/)** - User interface library
- **[Vite](https://vitejs.dev/)** - Fast build tool and dev server
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS framework
- **[CodeMirror](https://codemirror.net/)** - Advanced code editor
- **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** *(Optional)* - AI-powered project management

## Support & Community

### Stay Updated
- **Star** this repository to show support
- **Watch** for updates and new releases
- **Follow** the project for announcements

### Sponsors
- [Siteboon - AI powered website builder](https://siteboon.ai)

---

<div align="center">
  <strong>Made with care for the Claude Code, Cursor and Codex community.</strong>
</div>
