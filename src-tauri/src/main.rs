// no console window next to the app on Windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    hsk_companion_lib::run()
}
