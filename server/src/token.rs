use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;

use crate::models::ConnectionToken;

/// Generate a random invite code (8 alphanumeric chars)
pub fn generate_invite_code() -> String {
    let mut rng = rand::thread_rng();
    (0..8)
        .map(|_| {
            let idx = rng.gen_range(0..36);
            if idx < 10 {
                (b'0' + idx) as char
            } else {
                (b'a' + idx - 10) as char
            }
        })
        .collect()
}

/// Encode a ConnectionToken to a Base64 string
pub fn encode_token(token: &ConnectionToken) -> String {
    let json = serde_json::to_string(token).unwrap();
    URL_SAFE_NO_PAD.encode(json.as_bytes())
}

/// Decode a Base64 string back to a ConnectionToken
pub fn decode_token(encoded: &str) -> Result<ConnectionToken, String> {
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|e| format!("Invalid base64: {e}"))?;
    let json = String::from_utf8(bytes).map_err(|e| format!("Invalid UTF-8: {e}"))?;
    serde_json::from_str(&json).map_err(|e| format!("Invalid token JSON: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_decode_token() {
        let token = ConnectionToken {
            host: "192.168.1.10".to_string(),
            port: 3000,
            invite_code: "abc12345".to_string(),
        };
        let encoded = encode_token(&token);
        let decoded = decode_token(&encoded).unwrap();
        assert_eq!(decoded.host, "192.168.1.10");
        assert_eq!(decoded.port, 3000);
        assert_eq!(decoded.invite_code, "abc12345");
    }

    #[test]
    fn test_invite_code_length() {
        let code = generate_invite_code();
        assert_eq!(code.len(), 8);
        assert!(code.chars().all(|c| c.is_ascii_alphanumeric()));
    }
}
