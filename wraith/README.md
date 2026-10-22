# Wraith

A password-protected web proxy with a disguised front page.

Before the 4-digit code is entered, the site looks like "StudyLoop", a study timer.
To get in: double-click the small dot in the footer (or press the ` key), then enter your code.

## Put it online (Render, free)

1. Make a GitHub account, then create a new repository.
2. Upload this whole folder to it (you can skip the `node_modules` folder if one exists).
3. Go to render.com and sign in with GitHub.
4. Click New > Web Service and choose your repository.
5. Render fills in the settings from render.yaml. Under Environment, set:
   - PIN = your own 4 digits (for example 7391)
6. Click Create Web Service and wait a few minutes.
7. Open the https:// link Render gives you. Press the ` key, enter your PIN.

The free plan sleeps when unused, so the first visit after a break takes about a minute.

## Run on your own computer (optional)

Install Node.js, open this folder in a terminal, then:
```
npm install
npm start
```
Open http://localhost:8080. The default code is 1234.
To set your own: on Windows PowerShell, `$env:PIN="7391"; npm.cmd start`

## Change the code later

On Render: Environment tab, edit PIN, save. It redeploys on its own.
