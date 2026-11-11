//! The session token, kept in the system keychain (Keychain on macOS, Credential Manager on Windows).
//! It is never written to a file and never sent to the window.

const SERVICE: &str = "photos.hsk.companion";
const USER: &str = "desktop-session";

fn entry() -> Result<::keyring::Entry, String> {
    ::keyring::Entry::new(SERVICE, USER).map_err(|_| "Nu am putut deschide portofelul de parole al sistemului.".to_string())
}

pub fn save(token: &str) -> Result<(), String> {
    entry()?
        .set_password(token)
        .map_err(|_| "Nu am putut salva conectarea în portofelul de parole al sistemului.".to_string())
}

pub fn load() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|t| !t.is_empty())
}

pub fn clear() {
    if let Ok(e) = entry() {
        let _ = e.delete_credential();
    }
}
