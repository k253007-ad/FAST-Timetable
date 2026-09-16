// FAST NU-issued student email addresses encode a student's own roll number
// directly in the local part: "k" + 2-digit intake year + 4-digit roll
// number, e.g. "k253068@nu.edu.pk" -> roll number "25K-3068" (matches
// "26K-5123" for "k265123@nu.edu.pk"). Added 2026-09-16 so a Google sign-in
// with one of these addresses can auto-detect and sync the signed-in
// student's own roll number (App.jsx's `handleGoogleCredential`), and so a
// sign-in from any other email can be flagged distinctly (App.jsx's
// "signin-banner" — see its own comment for what shows instead).
const NU_EMAIL_ROLL_NO_REGEX = /^k(\d{2})(\d{4})@nu\.edu\.pk$/i;

export const isNuEmail = (email) => NU_EMAIL_ROLL_NO_REGEX.test(String(email || '').trim());

// Returns the roll number this email encodes, in the exact "YYK-NNNN" format
// Roll No mode/`getClassesForRollNo` already use everywhere else in this
// app (e.g. "25K-3068") — or null if the email isn't in the expected format.
export const getRollNoFromNuEmail = (email) => {
  const match = NU_EMAIL_ROLL_NO_REGEX.exec(String(email || '').trim());
  if (!match) return null;
  const [, year, number] = match;
  return `${year}K-${number}`;
};
