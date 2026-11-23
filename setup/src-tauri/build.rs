fn main() {
    // The real installer (Tauri's NSIS setup of hsk. studio) is copied here by the build before this crate is built.
    // Without it (a local `cargo check`) an empty file stands in, and installing says the setup is incomplete.
    let payload = std::path::Path::new("payload/setup-nsis.exe");
    if !payload.exists() {
        std::fs::create_dir_all("payload").ok();
        std::fs::write(payload, b"").expect("payload placeholder");
    }
    println!("cargo:rerun-if-changed=payload/setup-nsis.exe");
    tauri_build::build()
}
