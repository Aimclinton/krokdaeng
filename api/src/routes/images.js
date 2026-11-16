/**
 * GET /api/images/:key
 *
 * Streams a food photo straight out of the private R2 bucket (IMAGES
 * binding), so the bucket itself never needs to be made public. `key`
 * matches menu_items.image_key exactly (e.g. "menu/pad-thai-signature.jpg").
 * Cached aggressively since image keys are content-versioned by filename.
 */
export async function getImage(request, env, key) {
  if (!key) {
    return new Response("not_found", { status: 404 });
  }

  const object = await env.IMAGES.get(key);
  if (!object) {
    return new Response("not_found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=604800, immutable");
  headers.set("Access-Control-Allow-Origin", "*");

  return new Response(object.body, { headers });
}
