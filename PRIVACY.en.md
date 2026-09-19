# Privacy Policy

**Service** StreamKit+
**Developer** izunyadev
**Effective date** September 20, 2026

StreamKit+ is a Windows program for managing broadcast information and chat across several streaming platforms from one place. This policy explains what information the program handles and where it is kept.

## The developer collects nothing

StreamKit+ has no server operated by the developer. Information the program creates never leaves your PC for the developer.

There is no analytics or tracking code that gathers usage data. There are no ads.

## Information stored on your PC

The following is stored only on your PC, and the developer cannot see it.

**Login tokens** The authentication tokens you receive after signing in to a platform. They are locked with encryption provided by Windows (DPAPI) and can only be unlocked by the same user account on the same PC. Your password is never received or stored. Signing in happens on each platform's own website.

**Account display information** The display name and channel identifier, used to show which account is connected.

**OBS server password** Stored only if you use the OBS integration. It is encrypted the same way as tokens and is never shown again on screen.

**Program settings** Values kept for convenience, such as presets, apply history, the category search cache, and chat on/off settings.

These are stored in the `%APPDATA%\streamkit-plus` folder.

## Where information goes

**Connected streaming platforms** Requests are sent only to platforms you connected yourself. This happens when changing a broadcast title, category, or tags, when reading current broadcast information and chat, and when sending chat. YouTube, Twitch, CHZZK, and CIME are covered here.

**GitHub** Accessed only to check whether a new version exists and to download the installer. No user information is sent in the process.

**OBS** When the OBS integration is enabled, the connection stays within the same PC. Nothing goes outside.

Nothing is sent anywhere else. Information is not provided or sold to third parties.

## Handling of Google user data

This section covers the permission and data used for the YouTube integration specifically.

The app requests one scope, `https://www.googleapis.com/auth/youtube`. It is used for three things.

- Reading information about a broadcast that is live or scheduled, so the title, category, and tags currently set can be shown on screen.
- Changing broadcast information, applying the title, category, and tags the user entered.
- Reading and sending live chat, so messages appear in the combined chat view and what the user types is delivered.

Broadcast information and chat messages retrieved this way stay in memory while they are displayed and are never written to a file. The only thing stored is the authentication token, kept on the user's PC behind Windows encryption as described above.

Google user data is not handed to any other person or service. It is not sent to a developer server, it is not used for advertising or analytics, and no human reads it.

StreamKit+'s use and transfer of information received from Google APIs to any other app adheres to the Google API Services User Data Policy, including the Limited Use requirements.

## Chat is not stored

Only chat that arrives after you start the program appears on screen. It is held in memory only, so it disappears when the program closes and is never written to a file. Past chat history is not loaded.

## Permissions requested from platforms

Permissions requested at sign-in are limited to what the features need.

- Reading and changing broadcast information — needed to change titles, categories, and tags
- Reading and sending chat — needed for the combined chat feature

You can revoke access at any time in each platform's account settings.

## How to delete your information

**Disconnect a platform** Right-click a platform icon in the program and disconnect it. The tokens and account information for that platform are erased.

**Delete everything** Uninstall the program, then delete the `%APPDATA%\streamkit-plus` folder. All stored information is gone.

## Children

StreamKit+ is a tool for people who run live broadcasts and is not directed at children under 14.

## Changes to this policy

If the contents change, an updated policy is posted in the program's repository together with its effective date.

## Contact

For questions about how information is handled, please get in touch.

Developer izunyadev
Contact skp@izunya.dev
