# winget

How Leuria gets to the Windows Package Manager, as `Leuria.Leuria`
(`winget install Leuria.Leuria` once it is accepted there).

`manifests/` holds the manifests of the first submission to
[microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) (under
`manifests/l/Leuria/Leuria/<version>/` there). Later versions are sent by
`.github/workflows/winget.yml` when a release is published: it opens the pull
request to winget-pkgs from a fork, with a classic token (`public_repo` and
`workflow`) in the `WINGET_ACC_TOKEN` secret. Without the secret it does nothing.

Check manifests on Windows with `winget validate --manifest packaging/winget/manifests`
and try them with `winget install --manifest packaging/winget/manifests`.
