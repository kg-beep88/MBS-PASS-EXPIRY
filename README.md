# KG Pass Expiry Tracker

A simple mobile-friendly GitHub Pages app for tracking pass expiry dates.

## What it does

- Add, edit, and delete each person's **name, company, expiry date, and notes**.
- Pins expired and 0–15 day records in **red** at the top.
- Pins 16–30 day records in **yellow** below them.
- Sorts every list by the nearest expiry date first.
- Sends a daily email to **shayne@kgplasterceil.com.sg** containing all expired records and all records expiring within 15 days.
- Uses a private Google Sheet as the database.
- Uses an access PIN so the public GitHub page does not openly display the list.

## Important architecture

GitHub Pages only hosts static files and cannot run a scheduled email while nobody has the page open. Google Apps Script provides the database connection and scheduled email.

## Part 1 — Create the Google Sheet and backend

1. Create a new Google Sheet. Name it `KG Pass Expiry Database`.
2. In the Sheet, click **Extensions → Apps Script**.
3. Delete the sample code.
4. Open `apps-script/Code.gs` from this project and copy all of it into Apps Script.
5. Change this line near the top:

   ```javascript
   APP_PIN: 'CHANGE-ME-4826',
   ```

   Use a private PIN with at least 6 characters.
6. Confirm this line is correct:

   ```javascript
   ALERT_EMAIL: 'shayne@kgplasterceil.com.sg',
   ```

7. In Apps Script, click **Project Settings** and set the time zone to **(GMT+08:00) Singapore**.
8. Select the function `initialSetup` at the top, then click **Run**.
9. Approve the Google permissions. This creates the sheet headers and the daily email trigger.

## Part 2 — Deploy Apps Script as a web app

1. In Apps Script click **Deploy → New deployment**.
2. Click the gear icon and select **Web app**.
3. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
4. Click **Deploy**.
5. Copy the URL ending with `/exec`.

The PIN protects both viewing and editing. The Apps Script source and the Google Sheet remain inside the owner's Google account.

## Part 3 — Connect the GitHub page

1. Open `config.js`.
2. Replace:

   ```javascript
   SCRIPT_URL: "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE",
   ```

   with the `/exec` URL copied above.
3. Save the file.

## Part 4 — Publish on GitHub Pages

1. Create a new GitHub repository, for example `kg-pass-expiry`.
2. Upload everything in this project **except you may keep the apps-script folder as reference**.
3. Open the repository **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select branch **main** and folder **/(root)**, then click **Save**.
6. GitHub will show the website address after deployment.

## Test before using

1. Open the GitHub Pages website.
2. Enter the PIN you set in `Code.gs`.
3. Add one test record expiring in 10 days. It should appear in red.
4. Add one test record expiring in 20 days. It should appear in yellow.
5. In Apps Script, manually run `sendTestEmail` to test the email.

`sendTestEmail` only sends when the list contains an expired record or one expiring within 15 days.

## Daily email timing

The setup creates a time-driven trigger around **8:00 AM Singapore time**. Google Apps Script may run clock triggers slightly before or after the selected minute.

## Change the email time

Change:

```javascript
DAILY_EMAIL_HOUR: 8,
```

Then run `initialSetup()` again. It removes the old expiry email trigger and creates a new one.

## Change the alert rules

The website and email currently use:

- Red: expired or 0–15 days
- Yellow: 16–30 days

The backend email setting is controlled by:

```javascript
URGENT_DAYS: 15,
UPCOMING_DAYS: 30,
```

The website display thresholds are in `app.js` inside `getStatus()`.

## Security note

This simple version uses a shared PIN. It is suitable for a small internal team but is not the same as individual Google-account sign-in. Anyone who learns the PIN can view and change the list. Change the PIN in Apps Script and redeploy when staff access changes.

## Version 2 save-timeout fix

This version uses JSONP for both loading and saving records. After replacing `Code.gs`, update the existing Apps Script deployment to **New version**, then replace `app.js` and `service-worker.js` on GitHub. Refresh the website with `Ctrl + F5`.
