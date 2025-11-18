# Anime Night Tournament

A single-elimination tournament bracket generator for organizing anime-themed competitions with **real-time sync** powered by Supabase.

## ✨ Features

- **Add Participants**: Enter names for all participants (supports 2-128 participants)
- **Generate Tournament**: Automatically creates a single-elimination bracket
- **Interactive Bracket**: Click participant names to advance winners to the next round
- **🔐 Admin Authentication**: Secure login with custom admin codes
- **✓ Winner Confirmation**: Confirm dialog prevents accidental winner selection
- **🔄 Real-time Sync**: Multi-device/multi-user support - updates sync instantly across all devices
- **📊 Audit Logging**: Track all tournament changes and admin actions
- **Sample Data**: Quick option to load sample participants for testing
- **Fullscreen Mode**: View the bracket in fullscreen for presentations
- **Auto-save**: Tournament state automatically synced to cloud (Supabase) or browser storage

## 🚀 Quick Start

### For Viewers (No Setup Required)
Just open `index.html` in your browser - view-only mode works instantly!

### For Admins (First-Time Setup)
1. **Create a free Supabase account**: [https://app.supabase.com](https://app.supabase.com)
2. **Follow the setup guide**: See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for detailed instructions
3. **Configure your credentials**: Update `js/supabase-config.js` with your Supabase URL and key
4. **Set admin codes**: Customize your admin access codes in Supabase dashboard
5. **Start using**: Login as admin and manage your tournament!

## 🎮 How to Use

### As an Admin:
1. Click **"Admin Login"** and enter your admin code
2. Enter participant names in the text area (one per line)
3. Click **"Generate Tournament"** to create the bracket
4. Click on participant names to select winners
5. Confirm the winner in the dialog that appears
6. The tournament progresses until a winner is crowned!

### As a Viewer:
- Open the page and watch the tournament in real-time
- All updates from admins sync automatically
- No login required for viewing

## 📋 Requirements

- Modern web browser with JavaScript enabled
- Internet connection for real-time sync (works offline with localStorage fallback)
- Supabase account (free tier) for multi-device sync and admin features

## 🔧 Technical Stack

- **Frontend**: HTML5, CSS3 (with CSS Variables), Vanilla JavaScript (ES6+)
- **Backend**: Supabase (PostgreSQL + Realtime)
- **Real-time**: Supabase Realtime subscriptions
- **Authentication**: Custom code-based admin authentication
- **Storage**: Supabase Database with localStorage fallback

## License

MIT License - feel free to use this project for any purpose.
