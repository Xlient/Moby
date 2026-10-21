# Moby privacy policy

**DRAFT. Not yet reviewed by a lawyer.** Last updated: [DATE].

Moby is a disaster early-warning app. This policy explains what personal data Moby uses, why, and the
choices you have. We collect as little as we can, and we never sell your data or use it for
advertising.

## Who we are

Moby is operated by **[OPERATOR NAME]**, [ADDRESS, COUNTRY] ("we"). Contact: **[CONTACT EMAIL]**.
[EU representative, if appointed: NAME, ADDRESS.]

## What we use, and why

| Data | Why we use it | Legal basis (GDPR) | How long we keep it |
|---|---|---|---|
| Your email and name (or Google account name), when you create an account | To give you an account and sync your settings | Contract | Until you delete your account |
| Your settings: alert types, radius, saved areas | To show and send the alerts you asked for | Contract | Until you change them or delete your account |
| Your approximate location (about 1 km), if "Alerts follow my location" is on | To send push alerts for hazards near you | Contract (the service you asked for). You can turn it off at any time | Replaced as you move; deleted when you turn it off or delete your account |
| Your phone's push token and language | To send you notifications, and Moby's explanations in your language | Contract | Until you sign out, delete your account, or after 180 days without use |
| Which alerts were sent to your phone | To avoid sending the same alert twice | Legitimate interest | 30 days |
| Hazard reports you choose to send: location (exact, or about 500 m if you choose "approximate"), time, what you saw, and your optional note | To check reports against each other and against official sources, and to warn people nearby | Your consent when you send a report, and our legitimate interest in public safety | 90 days with your account link; then anonymised (your note and link to you are deleted, the location is coarsened) |
| Questions you ask Ask Moby, with your approximate location and country if location is on | To answer from official alerts near you and safety guidance | Contract (the service you asked for) | Not stored: used to answer, then discarded. Not sent to LangSmith |
| A destination or route you check with "Before you go": the point or each stop on the route (rounded to about 1 km), radius, trip dates, country, and the place names you picked from Moby's list | To find official alerts and community reports there and explain them | Contract (the service you asked for) | Not stored with your account. The rounded points, radius and dates are kept, with no link to you, in a cache of AI briefings for up to 2 days, so repeat requests don't cost another AI call. Trip packs you save stay on your phone until you delete them or your account |
| A route you check with "Route check": your start and destination points, and the place names you type to find them (with your location, so nearby places come first) | To find the usual route, the hazards it crosses and a way around them | Contract (the service you asked for) | Not stored. Sent to OpenRouteService to get the routes and place results, without your account or any device id |
| What your phone sends over the Bluetooth relay, if you turn it on (Android): for a report, the hazard type, severity, location (rounded to about 11 m) and time; for official alerts, only the alert itself; always a short id that changes every day. Never your name, email or note | To pass reports, alerts and calls for help between nearby phones when there's no signal | Your consent (the relay is off until you turn it on) | On nearby phones: until the message expires, usually within a day. Reports that reach our service are kept like other reports (see above) |
| When your phone passes on messages for others and has signal, which messages it uploaded, linked to a pseudonymous code for your account | To stop one phone from flooding the service. Passing a message on never counts as confirming it | Legitimate interest (preventing abuse) | 90 days for reports and 30 days for calls for help, or until you delete your account |
| A call for help from "I need help", if the Bluetooth relay is on: your location (rounded to about 11 m), the time, whether you need help or are safe now, and the same daily id | To show nearby Moby users that someone near them asked for help, and to show it to local partners (such as rangers or officials) who review alerts | Your consent when you send it, and the vital interests of the person asking for help | 30 days, then deleted |
| The offline AI model, if you download it in Settings → Offline answers | To answer safety questions with no signal, on your phone | Contract (the service you asked for) | The model is downloaded from Hugging Face, which sees your IP address like any download. Questions you ask offline never leave your phone. Delete the model in the same screen |

**What's never public:** your name, email, notes, exact report locations or which reports are yours.
Others only ever see that "people nearby" reported something, roughly where, and when.

**Bluetooth relay and calls for help.** Bluetooth messages are broadcast, not sent to one person, so any
phone or Bluetooth device in range (usually up to about 100 m) can receive them, not only Moby phones.
That's why they never carry your name, email or notes, and why the id changes every day. A call for
help does carry your location, so nearby people can find you. Moby never tells you that someone saw a
call for help, and it doesn't contact emergency services for you: call your local emergency number
whenever you can. Because Bluetooth messages carry only the daily id, we can't link them to your
account.

**Automated processing:** Reports are processed by AI models to extract details, group reports about
the same event, translate official warnings, explain them in plain words, and answer questions in Ask
Moby and Before you go from cited official sources. Community reports are shown to other
users nearby who chose to see them, always marked unverified, and never with your name or note.
Nothing about you is decided automatically.

## Who else handles your data (processors)

| Service | What for | Where |
|---|---|---|
| Google (Firebase Authentication, Firestore, Cloud Messaging, App Check, Maps) | Accounts, settings, notifications, abuse prevention, maps | USA and other countries; EU Standard Contractual Clauses |
| Nebius | Hosting our service and database; AI models | European Union |
| LangChain (LangSmith) | Monitoring the AI pipeline's quality, if enabled | USA; EU Standard Contractual Clauses |
| Tavily | Web search for context about hazards (e.g. official bulletins and news), using only the hazard type, place and time, never your notes or identity. For Ask Moby, a short search query rewritten by AI to remove personal details, searched on official government websites only. For Before you go, a query made only from the hazard types found, the place names you picked from Moby's list (a route's first and last stop) and the country, on official government websites only | USA; EU Standard Contractual Clauses |

| OpenRouteService (HeiGIT gGmbH) | Routes and place search for Route check, using only the points and place names you entered | Germany (European Union) |

Official warnings come from public agencies. We don't send them your data. The offline AI model is a
public download from Hugging Face (USA); we don't send Hugging Face any data about you.

## Your rights

You can, at any time:
- **download your data:** Settings → Privacy & data → Download my data;
- **delete your account and data:** Settings → Privacy & data → Delete my account. Or ask us at
  [CONTACT EMAIL], or via the [account deletion page](/legal/delete-account);
- **correct** your name and settings in the app;
- **turn off location for alerts**, or send reports with an approximate location;
- **turn off the Bluetooth relay** in Settings → Nearby phones, and **delete the offline AI model** in
  Settings → Offline answers;
- **object** to processing, or **withdraw consent**, without affecting what was done before.

Deleted data disappears from our backups within 14 days.

You can also complain to your data protection authority, for example in your EU country of residence.

## Children

Moby is for people aged **16 and over** [confirm].

## Security

Data is encrypted in transit. Our database is not reachable from the internet. Only the official Moby
app can use our service. We will tell you and the authorities about any breach that puts your rights at
risk, as the law requires.

## Changes

We'll tell you in the app before significant changes take effect.
