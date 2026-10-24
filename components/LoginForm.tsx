/**
 * Password form for the single shared demo login. It posts the password in the
 * form body to /api/login. It does not put the password in an Authorization
 * header, read document.cookie, call Supabase, or touch accounts and refunds.
 */

import styles from "./LoginForm.module.css";

export function LoginForm() {
  return (
    <form className={styles.form} method="post" action="/api/login">
      <label className={styles.label} htmlFor="password">
        Password
      </label>
      <input
        className={styles.input}
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <button className={styles.button} type="submit">
        Sign in
      </button>
    </form>
  );
}
