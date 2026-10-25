export const setStorage = (key, value) => {
  if (typeof document === 'undefined') return;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  
  if (key.includes('session') || key.includes('token')) {
    document.cookie = `${key}=${encodeURIComponent(str)}; path=/; max-age=864000`;
  } else {
    sessionStorage.setItem(key, str);
  }
  try { localStorage.removeItem(key); } catch {}
};

export const getStorage = (key) => {
  if (typeof document === 'undefined') return null;
  
  if (key.includes('session') || key.includes('token')) {
    const match = document.cookie.match(new RegExp(`(^| )${key}=([^;]+)`));
    if (match) {
      try {
        return decodeURIComponent(match[2]);
      } catch {
        return null;
      }
    }
    return null;
  } else {
    return sessionStorage.getItem(key);
  }
};

export const removeStorage = (key) => {
  if (typeof document === 'undefined') return;
  
  if (key.includes('session') || key.includes('token')) {
    document.cookie = `${key}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  } else {
    sessionStorage.removeItem(key);
  }
  try { localStorage.removeItem(key); } catch {}
};

try {
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }
} catch {}
