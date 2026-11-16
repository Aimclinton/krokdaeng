/**
 * krokdaeng LIFF app config.
 *
 * Fill these in once the Worker API is deployed and a LIFF app is
 * registered in the LINE Developers console:
 *   - API_BASE: the deployed Worker's URL (e.g. "https://krokdaeng-api.<your-subdomain>.workers.dev"),
 *     or a custom domain route if one is attached to the Worker.
 *   - LIFF_ID: from LINE Developers console > your channel > LIFF > LIFF ID.
 *
 * DEFAULT_BRANCH_ID is used until a real branch picker is needed (today
 * there is only one branch seeded, id 1).
 */
window.KROKDAENG_CONFIG = {
  API_BASE: "https://krokdaeng-api.YOUR-SUBDOMAIN.workers.dev",
  LIFF_ID: "YOUR-LIFF-ID",
  DEFAULT_BRANCH_ID: 1,
};
