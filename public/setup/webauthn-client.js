/*
 * webauthn-client.js
 * A compact, robust WebAuthn client module for browser admin UIs.
 * - Normalizes backend options (base64url -> ArrayBuffer)
 * - Converts challenges where useful
 * - Provides startRegistration() and startAuthentication() helpers
 * - Handles SimpleWebAuthnBrowser loading fallback
 *
 * Usage (simple):
 *   <script src="/path/to/webauthn-client.js"></script>
 *   WebAuthnClient.init({ apiBase: '/api/auth' });
 *   // register
 *   await WebAuthnClient.register({ promptDeviceName: true });
 *   // authenticate
 *   await WebAuthnClient.authenticate();
 *
 * The module intentionally keeps no external dependencies beyond
 * the simplewebauthn/browser UMD bundle which it will try to
 * ensure is present on window.SimpleWebAuthnBrowser.
 */

(function (window) {
    'use strict';
  
    // -----------------------------
    // Helpers
    // -----------------------------
    function b64urlToUint8Array(b64url) {
      if (!b64url) return new Uint8Array();

      // Defensive: if it's an Error object, don't try to process it
      if (b64url instanceof Error) {
        throw new Error('b64urlToUint8Array received Error object: ' + (b64url.message || String(b64url)));
      }

      // Already a Uint8Array
      if (b64url instanceof Uint8Array) return b64url;

      // ArrayBuffer => Uint8Array
      if (b64url instanceof ArrayBuffer) return new Uint8Array(b64url);

      // Array of numbers (very common when server accidentally sends raw bytes)
      if (Array.isArray(b64url)) {
        return new Uint8Array(b64url);
      }

      // If it's a Number (single numeric id) convert to 1-byte array (unlikely)
      if (typeof b64url === 'number') return new Uint8Array([b64url]);

      // If it's an object with .data or .buffer, try to extract (defensive)
      if (b64url && typeof b64url === 'object') {
        // Skip Error-like objects
        if ('message' in b64url && 'stack' in b64url) {
          throw new Error('b64urlToUint8Array received Error-like object: ' + (b64url.message || String(b64url)));
        }
        if (b64url.data && Array.isArray(b64url.data)) return new Uint8Array(b64url.data);
        if (b64url.buffer && b64url.buffer instanceof ArrayBuffer) return new Uint8Array(b64url.buffer);
      }

      // Otherwise treat as string (base64url)
      if (typeof b64url !== 'string') {
        // This prevents attempting .replace on non-strings and gives clearer error
        throw new Error('Invalid base64url input type: ' + typeof b64url + ' (value: ' + String(b64url).substring(0, 50) + ')');
      }

      let s = b64url.replace(/-/g, '+').replace(/_/g, '/');

      // fix padding if missing
      const pad = s.length % 4;
      if (pad === 2) s += '==';
      else if (pad === 3) s += '=';
      else if (pad !== 0) {
        throw new Error('Invalid base64url string');
      }

      const binary = atob(s);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
  
    function uint8ArrayToB64url(buffer) {
      if (!buffer) return '';
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      // btoa always returns a string, but add defensive check
      if (typeof base64 !== 'string') {
        throw new Error('btoa returned non-string: ' + typeof base64);
      }
      return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
  
    function convertCredentialIdArrays(options) {
      if (!options) return options;
      // Shallow clone - we'll handle nested objects manually
      const clone = Object.assign({}, options);
      // Deep clone nested objects that we'll modify
      if (clone.user) clone.user = Object.assign({}, clone.user);
      if (clone.rp) clone.rp = Object.assign({}, clone.rp);
  
      ['allowCredentials', 'excludeCredentials'].forEach(key => {
        if (Array.isArray(clone[key])) {
          clone[key] = clone[key].map(item => {
            if (!item) return item;
            
            console.log("CREDENTIAL ID RAW TYPE:", typeof item.id, item.id);
            console.log("AUTH ID TYPE BEFORE CONVERSION:", typeof item.id, item.id);
            
            // CRITICAL: SimpleWebAuthnBrowser v9 expects credential IDs as base64url STRINGS, not ArrayBuffer!
            // The library handles the conversion internally. Converting to ArrayBuffer causes "e.replace is not a function" error.
            // Keep credential IDs as strings - do NOT convert to ArrayBuffer
            if (typeof item.id === 'string') {
              // Already a string - keep it as-is
              console.log(`CREDENTIAL ID (${key}): Keeping as string (SimpleWebAuthnBrowser v9 expects base64url string)`);
              return item;
            }
            
            // If it's already an ArrayBuffer or Uint8Array, convert back to base64url string
            if (item.id instanceof ArrayBuffer || item.id instanceof Uint8Array) {
              console.log(`CREDENTIAL ID (${key}): Converting ArrayBuffer/Uint8Array back to base64url string`);
              const uint8Array = item.id instanceof ArrayBuffer ? new Uint8Array(item.id) : item.id;
              const base64url = uint8ArrayToB64url(uint8Array);
              return Object.assign({}, item, {
                id: base64url,
              });
            }
            
            // If it's an array of numbers, convert to base64url string
            if (Array.isArray(item.id)) {
              console.log(`CREDENTIAL ID (${key}): Converting array to base64url string`);
              const uint8Array = new Uint8Array(item.id);
              const base64url = uint8ArrayToB64url(uint8Array);
              return Object.assign({}, item, {
                id: base64url,
              });
            }
            
            // If id is missing or unexpected type, log warning but return as-is
            if (!item.id) {
              console.warn(`webauthn-client: credential id (${key}) is missing`);
              return item;
            }
            
            console.warn(`webauthn-client: credential id (${key}) is unexpected type:`, typeof item.id);
            return item;
          });
        }
      });
  
      // Handle challenge - SimpleWebAuthnBrowser v9 expects challenge as base64url STRING, not ArrayBuffer!
      // The library will convert it internally. Converting to ArrayBuffer causes "e.replace is not a function" error.
      if (clone.challenge) {
        console.log("CHALLENGE RAW TYPE:", typeof clone.challenge, clone.challenge);
        
        // If it's already a string (base64url), keep it as-is - SimpleWebAuthnBrowser v9 expects strings
        if (typeof clone.challenge === 'string') {
          console.log("CHALLENGE: Keeping as string (SimpleWebAuthnBrowser v9 expects base64url string)");
          // Already in correct format - do nothing
        } else if (clone.challenge instanceof ArrayBuffer) {
          // If it's an ArrayBuffer, convert back to base64url string
          console.log("CHALLENGE: Converting ArrayBuffer to base64url string");
          const uint8Array = new Uint8Array(clone.challenge);
          clone.challenge = uint8ArrayToB64url(uint8Array);
          console.log("CHALLENGE: Converted ArrayBuffer to string");
        } else if (clone.challenge instanceof Uint8Array) {
          // If it's a Uint8Array, convert to base64url string
          console.log("CHALLENGE: Converting Uint8Array to base64url string");
          clone.challenge = uint8ArrayToB64url(clone.challenge);
          console.log("CHALLENGE: Converted Uint8Array to string");
        } else if (Array.isArray(clone.challenge)) {
          // If it's an array of numbers, convert to base64url string
          console.log("CHALLENGE: Converting array to base64url string");
          const uint8Array = new Uint8Array(clone.challenge);
          clone.challenge = uint8ArrayToB64url(uint8Array);
          console.log("CHALLENGE: Converted array to string");
        } else {
          console.warn("CHALLENGE: Unexpected type, leaving as-is:", typeof clone.challenge);
        }
      } else {
        console.warn("CHALLENGE: No challenge found in options!");
      }
  
      // Also convert user.id if present (SimpleWebAuthnBrowser expects Uint8Array/ArrayBuffer)
      if (clone.user && clone.user.id) {
        console.log("USER.ID RAW TYPE:", typeof clone.user.id, clone.user.id);
        if (!(clone.user.id instanceof ArrayBuffer) && !(clone.user.id instanceof Uint8Array)) {
          try {
            if (typeof clone.user.id === 'string') {
              const userIdBytes = b64urlToUint8Array(clone.user.id);
              clone.user.id = userIdBytes.buffer;
              console.log("USER.ID: Converted string to ArrayBuffer");
            } else if (Array.isArray(clone.user.id)) {
              clone.user.id = new Uint8Array(clone.user.id).buffer;
              console.log("USER.ID: Converted array to ArrayBuffer");
            }
          } catch (e) {
            console.warn('webauthn-client: failed to convert user.id', e);
            // Don't throw - let SimpleWebAuthnBrowser handle it
          }
        }
      }

      // Log final state of all options before returning
      console.log("convertCredentialIdArrays FINAL STATE:", {
        challenge: clone.challenge instanceof ArrayBuffer ? `ArrayBuffer(${clone.challenge.byteLength})` : (typeof clone.challenge === 'string' ? `string(${clone.challenge.length})` : typeof clone.challenge),
        rpId: clone.rpId,
        rp: clone.rp ? { id: clone.rp.id, name: clone.rp.name } : null,
        user: clone.user ? { id: clone.user.id instanceof ArrayBuffer ? `ArrayBuffer(${clone.user.id.byteLength})` : typeof clone.user.id, name: clone.user.name } : null,
        allowCredentials: clone.allowCredentials ? clone.allowCredentials.map(c => ({ id: c.id instanceof ArrayBuffer ? `ArrayBuffer(${c.id.byteLength})` : typeof c.id })) : null,
        excludeCredentials: clone.excludeCredentials ? clone.excludeCredentials.map(c => ({ id: c.id instanceof ArrayBuffer ? `ArrayBuffer(${c.id.byteLength})` : typeof c.id })) : null
      });
  
      return clone;
    }
  
    // Ensure SimpleWebAuthn is loaded
    async function ensureSimpleWebAuthn() {
      if (typeof window.SimpleWebAuthnBrowser !== 'undefined') return;
  
      if (typeof SimpleWebAuthnBrowser !== 'undefined') {
        window.SimpleWebAuthnBrowser = SimpleWebAuthnBrowser;
        return;
      }
  
      const cdn = 'https://cdn.jsdelivr.net/npm/@simplewebauthn/browser@9.0.0/dist/bundle/index.umd.min.js';
  
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = cdn;
        script.async = true;
        script.onload = () => {
          if (typeof window.SimpleWebAuthnBrowser === 'undefined'
              && typeof SimpleWebAuthnBrowser !== 'undefined') {
            window.SimpleWebAuthnBrowser = SimpleWebAuthnBrowser;
          }
          if (typeof window.SimpleWebAuthnBrowser !== 'undefined') resolve();
          else reject(new Error('SimpleWebAuthnBrowser failed to load'));
        };
        script.onerror = () => reject(new Error('Failed to load SimpleWebAuthnBrowser'));
        document.head.appendChild(script);
      });
    }
  
    async function clientLog(apiBase, message, meta = {}) {
      try {
        await fetch(apiBase + '/webauthn/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, meta }),
        });
      } catch (e) {
        // ignore
      }
    }
  
    const WebAuthnClient = {
      apiBase: '/api/auth',
  
      init(opts = {}) {
        if (opts.apiBase) this.apiBase = opts.apiBase;
      },
  
      async register({ promptDeviceName = false } = {}) {
        try {
          await ensureSimpleWebAuthn();
        } catch (e) {
          console.error('[WebAuthnClient] Error ensuring SimpleWebAuthn:', e);
          throw new Error('Failed to load WebAuthn library: ' + (e && typeof e === 'object' && 'message' in e ? e.message : String(e)));
        }

        let resp;
        try {
          resp = await fetch(this.apiBase + '/webauthn/register/options', {
            method: 'POST',
          });
        } catch (e) {
          console.error('[WebAuthnClient] Error fetching registration options:', e);
          throw new Error('Network error fetching registration options: ' + (e && typeof e === 'object' && 'message' in e ? e.message : String(e)));
        }
        
        if (!resp.ok) {
          const errorText = await resp.text().catch(() => 'Unknown error');
          throw new Error('Failed to fetch registration options: ' + errorText);
        }
        
        let options;
        try {
          options = await resp.json();
        } catch (e) {
          console.error('[WebAuthnClient] Error parsing registration options JSON:', e);
          throw new Error('Invalid JSON response from server: ' + (e && typeof e === 'object' && 'message' in e ? e.message : String(e)));
        }

        // DEBUG: inspect server options to catch type/format problems
        try {
          // Print a compact version to console, avoid huge binary dumps
          let challengePreview = 'unknown';
          try {
            if (typeof options.challenge === 'string' && options.challenge.length < 120) {
              challengePreview = options.challenge;
            } else if (Array.isArray(options.challenge)) {
              challengePreview = `Array(${options.challenge.length})`;
            } else if (options.challenge && typeof options.challenge === 'object' && 'byteLength' in options.challenge) {
              challengePreview = `ArrayBuffer(${options.challenge.byteLength})`;
            } else {
              challengePreview = String(typeof options.challenge);
            }
          } catch (e) {
            challengePreview = 'error: ' + (e.message || String(e));
          }
          
          console.debug('WEBAUTHN options from server (preview):', {
            rpId: options.rpId,
            challengeType: typeof options.challenge,
            challengePreview: challengePreview,
            allowCredentialsCount: Array.isArray(options.allowCredentials) ? options.allowCredentials.length : 0,
            excludeCredentialsCount: Array.isArray(options.excludeCredentials) ? options.excludeCredentials.length : 0,
          });
        } catch (e) {
          console.debug('WEBAUTHN debug logging failed', e);
        }

        console.log("RAW OPTIONS FROM SERVER >>>", options);

        try {
          options = convertCredentialIdArrays(options);
          console.log("OPTIONS AFTER CONVERSION >>>", {
            challengeType: typeof options.challenge,
            challengeIsArrayBuffer: options.challenge instanceof ArrayBuffer,
            challengeIsUint8Array: options.challenge instanceof Uint8Array,
            challengeValue: options.challenge instanceof ArrayBuffer ? `ArrayBuffer(${options.challenge.byteLength})` : (options.challenge instanceof Uint8Array ? `Uint8Array(${options.challenge.length})` : (typeof options.challenge === 'string' ? options.challenge.substring(0, 30) + '...' : String(options.challenge))),
            rpId: options.rp?.id,
            userId: options.user?.id,
            userDisplayName: options.user?.displayName,
            userName: options.user?.name
          });
          
          // Final check: ensure challenge is a string (base64url) before passing to SimpleWebAuthnBrowser
          if (options.challenge && typeof options.challenge !== 'string') {
            console.error("ERROR: Challenge is not a string after conversion!", {
              type: typeof options.challenge,
              isArrayBuffer: options.challenge instanceof ArrayBuffer,
              isUint8Array: options.challenge instanceof Uint8Array,
              value: options.challenge
            });
            throw new Error('Challenge must be a string (base64url) but got: ' + typeof options.challenge);
          }
          
          // Log the complete options object structure before passing to SimpleWebAuthnBrowser
          console.log("FINAL OPTIONS BEING PASSED TO startRegistration:", {
            challenge: options.challenge instanceof ArrayBuffer ? `ArrayBuffer(${options.challenge.byteLength})` : options.challenge,
            rp: {
              id: options.rp?.id,
              name: options.rp?.name
            },
            user: {
              id: options.user?.id instanceof ArrayBuffer ? `ArrayBuffer(${options.user.id.byteLength})` : options.user?.id,
              name: options.user?.name,
              displayName: options.user?.displayName
            },
            pubKeyCredParams: options.pubKeyCredParams?.length,
            timeout: options.timeout,
            excludeCredentials: options.excludeCredentials?.length,
            allowCredentials: options.allowCredentials?.length,
            authenticatorSelection: options.authenticatorSelection
          });
        } catch (e) {
          const errorMsg = e && typeof e === 'object' && 'message' in e ? e.message : String(e);
          console.error('webauthn-client: error converting options', e, { 
            errorType: typeof e,
            errorMessage: errorMsg,
            options: options 
          });
          throw new Error('Failed to process registration options: ' + errorMsg);
        }

        console.log("CALLING startRegistration with options object:", options);
        const attestation =
          await window.SimpleWebAuthnBrowser.startRegistration(options);
  
        let deviceName = 'Security Key';
  
        if (promptDeviceName) {
          try {
            const name = prompt('Enter a friendly name for this security key (optional):');
            if (name && name.trim().length) deviceName = name.trim();
          } catch (e) {}
        }
  
        const verifyResp = await fetch(this.apiBase + '/webauthn/register/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({}, attestation, { deviceName })),
        });
  
        if (!verifyResp.ok) {
          const txt = await verifyResp.text();
          throw new Error('Registration verification failed: ' + txt);
        }
  
        const verifyJson = await verifyResp.json();
        if (!verifyJson.verified) {
          throw new Error(
            'Registration not verified: ' + (verifyJson.error || 'unknown'),
          );
        }
  
        return verifyJson;
      },
  
      async authenticate() {
        await ensureSimpleWebAuthn();
  
        const resp = await fetch(this.apiBase + '/webauthn/authenticate/options', {
          method: 'POST',
        });
        if (!resp.ok)
          throw new Error('Failed to fetch authentication options');

        let options = await resp.json();

        // DEBUG: inspect server options to catch type/format problems
        try {
          // Print a compact version to console, avoid huge binary dumps
          let challengePreview = 'unknown';
          try {
            if (typeof options.challenge === 'string' && options.challenge.length < 120) {
              challengePreview = options.challenge;
            } else if (Array.isArray(options.challenge)) {
              challengePreview = `Array(${options.challenge.length})`;
            } else if (options.challenge && typeof options.challenge === 'object' && 'byteLength' in options.challenge) {
              challengePreview = `ArrayBuffer(${options.challenge.byteLength})`;
            } else {
              challengePreview = String(typeof options.challenge);
            }
          } catch (e) {
            challengePreview = 'error: ' + (e && typeof e === 'object' && 'message' in e ? e.message : String(e));
          }
          
          console.debug('WEBAUTHN options from server (preview):', {
            rpId: options.rpId,
            challengeType: typeof options.challenge,
            challengePreview: challengePreview,
            allowCredentialsCount: Array.isArray(options.allowCredentials) ? options.allowCredentials.length : 0,
            excludeCredentialsCount: Array.isArray(options.excludeCredentials) ? options.excludeCredentials.length : 0,
          });
        } catch (e) {
          console.debug('WEBAUTHN debug logging failed', e);
        }

        console.log("RAW OPTIONS FROM SERVER >>>", options);
        console.log("AUTH OPTIONS RAW", options);
        console.log("allowCredentials:", options.allowCredentials);

        try {
          options = convertCredentialIdArrays(options);
          
          // Final validation and logging before calling startAuthentication
          console.log("AUTHENTICATE: OPTIONS AFTER CONVERSION >>>", {
            challengeType: typeof options.challenge,
            challengeIsString: typeof options.challenge === 'string',
            challengeValue: typeof options.challenge === 'string' ? options.challenge.substring(0, 30) + '...' : options.challenge,
            rpId: options.rpId,
            allowCredentialsCount: options.allowCredentials?.length || 0,
            allowCredentialsFirstId: options.allowCredentials?.[0]?.id instanceof ArrayBuffer ? `ArrayBuffer(${options.allowCredentials[0].id.byteLength})` : typeof options.allowCredentials?.[0]?.id
          });
          console.log(options.allowCredentials[0].id instanceof ArrayBuffer);
          
          // Ensure challenge is a string
          if (options.challenge && typeof options.challenge !== 'string') {
            console.error("AUTHENTICATE ERROR: Challenge is not a string!", {
              type: typeof options.challenge,
              value: options.challenge
            });
            throw new Error('Challenge must be a string (base64url) but got: ' + typeof options.challenge);
          }
          
          // Sanitize options - only include fields that SimpleWebAuthnBrowser expects
          // This prevents issues with unexpected fields
          const sanitizedOptions = {
            challenge: options.challenge,
            rpId: options.rpId,
            timeout: options.timeout,
            userVerification: options.userVerification,
            allowCredentials: options.allowCredentials,
            // Include other standard fields if present
            ...(options.extensions ? { extensions: options.extensions } : {}),
            ...(options.attestation ? { attestation: options.attestation } : {}),
          };
          
          console.log("AUTHENTICATE: Sanitized options (removed unexpected fields):", Object.keys(sanitizedOptions));
          options = sanitizedOptions;
        } catch (e) {
          const errorMsg = e && typeof e === 'object' && 'message' in e ? e.message : String(e);
          console.error('webauthn-client: error converting options', e, { 
            errorType: typeof e,
            errorMessage: errorMsg,
            options: options 
          });
          throw new Error('Failed to process authentication options: ' + errorMsg);
        }

        console.log("AUTHENTICATE: CALLING startAuthentication with:", {
          challenge: options.challenge,
          challengeType: typeof options.challenge,
          rpId: options.rpId,
          rpIdType: typeof options.rpId,
          allowCredentials: options.allowCredentials?.map(c => ({ 
            id: c.id instanceof ArrayBuffer ? `ArrayBuffer(${c.id.byteLength})` : (typeof c.id),
            type: c.type,
            transports: c.transports
          })),
          timeout: options.timeout,
          userVerification: options.userVerification
        });

        let assertion;
        try {
          assertion = await window.SimpleWebAuthnBrowser.startAuthentication(options);
          console.log("AUTHENTICATE: Assertion response received:", {
            hasId: !!assertion.id,
            hasRawId: !!assertion.rawId,
            idType: typeof assertion.id,
            rawIdType: typeof assertion.rawId,
            idValue: assertion.id ? (typeof assertion.id === 'string' ? assertion.id.substring(0, 30) + '...' : 'ArrayBuffer/Uint8Array') : null,
            hasResponse: !!assertion.response,
            responseKeys: assertion.response ? Object.keys(assertion.response) : []
          });
        } catch (e) {
          console.error("AUTHENTICATE: startAuthentication threw error:", e);
          console.error("AUTHENTICATE: Error details:", {
            message: e?.message,
            stack: e?.stack,
            name: e?.name,
            optionsAtError: {
              challenge: options.challenge,
              challengeType: typeof options.challenge,
              rpId: options.rpId,
              allowCredentials: options.allowCredentials
            }
          });
          throw e;
        }
  
        console.log("AUTHENTICATE: Sending assertion to server:", {
          id: assertion.id,
          idType: typeof assertion.id,
          rawId: assertion.rawId,
          rawIdType: typeof assertion.rawId
        });
  
        const verifyResp = await fetch(
          this.apiBase + '/webauthn/authenticate/verify',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(assertion),
          },
        );
  
        if (!verifyResp.ok) {
          const txt = await verifyResp.text();
          throw new Error('Authentication verification failed: ' + txt);
        }
  
        const verifyJson = await verifyResp.json();
  
        if (!verifyJson.verified) {
          throw new Error(
            'Authentication not verified: ' + (verifyJson.error || 'unknown'),
          );
        }
  
        return verifyJson;
      },
  
      normalizeStoredCredentials(credentials = []) {
        return (credentials || []).map(c => ({
          ...c,
          credentialIDb64: c.credentialID,
          credentialID: c.credentialID
            ? b64urlToUint8Array(c.credentialID).buffer
            : null,
        }));
      },
    };
  
    window.WebAuthnClient = WebAuthnClient;
  
  })(window);
  