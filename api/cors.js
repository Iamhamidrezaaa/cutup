// CORS helper function
export function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-Session-Id'
  );
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Disposition, Content-Length, Content-Type'
  );
  res.setHeader('Access-Control-Allow-Credentials', 'false');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/** Admin panel uses cookies; echo Origin + credentials when browser sends Origin (cross-subdomain / preflight). */
export function setAdminPanelCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && /^https?:\/\/.+/i.test(String(origin).trim())) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'false');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-Session-Id',
  );
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function handleCORS(req, res) {
  setCORSHeaders(res);
  
  if (req.method === 'OPTIONS') {
    console.log('CORS: Handling OPTIONS preflight request');
    return res.status(200).json({ message: 'OK' });
  }
  
  return false; // Continue with normal request
}

