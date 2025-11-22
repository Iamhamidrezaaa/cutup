// CORS helper function
export function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'false');
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

