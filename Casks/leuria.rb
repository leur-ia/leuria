cask "leuria" do
  arch arm: "apple-silicon", intel: "intel"

  version "0.1.8"
  sha256 arm:   "8fa31c2f216a4e094b89624a8500eea98712dff1fc4abc189eaaf9329cb4b285",
         intel: "90caee94953f76856eb64fd2fe0e4bf1353e9961c013d9b13b8d797e6d9f0231"

  url "https://github.com/leur-ia/leuria/releases/download/v#{version}/Leuria-mac-#{arch}.dmg"
  name "Leuria"
  desc "Use your own AI on the websites you choose"
  homepage "https://leuria.eu/"

  livecheck do
    url :url
    strategy :github_latest
  end

  # Leuria updates itself.
  auto_updates true
  depends_on macos: ">= :big_sur"

  app "Leuria.app"

  uninstall quit:      "eu.leuria.app",
            launchctl: "Leuria",
            delete:    "~/Library/LaunchAgents/Leuria.plist"

  zap trash: [
    "~/.leuria",
    "~/Library/Application Support/eu.leuria.app",
    "~/Library/Caches/eu.leuria.app",
    "~/Library/WebKit/eu.leuria.app",
  ]

  caveats <<~EOS
    Leuria is not signed by Apple yet. The first time you open it, macOS asks
    you to confirm: open System Settings > Privacy & Security and click
    "Open Anyway" next to Leuria.
  EOS
end
