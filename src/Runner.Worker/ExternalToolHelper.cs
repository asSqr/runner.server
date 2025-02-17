using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using GitHub.Runner.Common;
using GitHub.Runner.Sdk;

namespace GitHub.Runner.Worker
{
    public class ExternalToolHelper {
         public static string GetHostArch() {
            switch(System.Runtime.InteropServices.RuntimeInformation.OSArchitecture) {
                case System.Runtime.InteropServices.Architecture.X86:
                    return "386";
                case System.Runtime.InteropServices.Architecture.X64:
                    return "amd64";
                case System.Runtime.InteropServices.Architecture.Arm:
                    return "arm";
                case System.Runtime.InteropServices.Architecture.Arm64:
                    return "arm64";
                default:
                    throw new InvalidOperationException();
            }
        }

        public static string GetHostOS() {
            if(System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.Linux)) {
                return "linux";
            } else if(System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.Windows)) {
                return "windows";
            } else if(System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.OSX)) {
                return "osx";
            }
            return null;
        }

        private static string NodeOfficialUrl(string NODE_URL, string NODE12_VERSION, string os, string arch, string suffix) {
            return $"{NODE_URL}/v{NODE12_VERSION}/node-v{NODE12_VERSION}-{os}-{arch}.{suffix}";
        }

        private static async Task DownloadTool(IHostContext hostContext, IExecutionContext executionContext, string link, string destDirectory, string tarextraopts = "", bool unwrap = false) {
            executionContext.Write("", $"Downloading from {link} to {destDirectory}");
            string tempDirectory = Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.ApplicationData), "runner.server", "temp" + System.Guid.NewGuid().ToString());
            var stagingDirectory = Path.Combine(tempDirectory, "_staging");
            var stagingDirectory2 = Path.Combine(tempDirectory, "_staging2");
            try {
                Directory.CreateDirectory(stagingDirectory);
                Directory.CreateDirectory(stagingDirectory2);
                Directory.CreateDirectory(destDirectory);
                string archiveName = "";
                {
                    var lastSlash = link.LastIndexOf('/');
                    if(lastSlash != -1) {
                        archiveName = link.Substring(lastSlash + 1);
                    } else {
                        throw new Exception("Failed to get basename of url");
                    }
                }
                string archiveFile = Path.Combine(tempDirectory, archiveName);

                using (FileStream fs = new FileStream(archiveFile, FileMode.Create, FileAccess.Write, FileShare.None, bufferSize: 4096, useAsync: true))
                using (var httpClientHandler = hostContext.CreateHttpClientHandler())
                using (var httpClient = new HttpClient(httpClientHandler))
                {
                    using (var response = await httpClient.GetAsync(link))
                    {
                        response.EnsureSuccessStatusCode();
                        using (var result = await response.Content.ReadAsStreamAsync())
                        {
                            await result.CopyToAsync(fs, 4096, CancellationToken.None);
                            await fs.FlushAsync(CancellationToken.None);
                        }
                    }
                }

                if(archiveName.ToLower().EndsWith(".zip")) {
                    ZipFile.ExtractToDirectory(archiveFile, stagingDirectory);
                } else if (archiveName.ToLower().EndsWith(".tar.gz")) {
                    string tar = WhichUtil.Which("tar", require: true);

                    // tar -xzf
                    using (var processInvoker = hostContext.CreateService<IProcessInvoker>())
                    {
                        processInvoker.OutputDataReceived += new EventHandler<ProcessDataReceivedEventArgs>((sender, args) =>
                        {
                            if (!string.IsNullOrEmpty(args.Data))
                            {
                                executionContext.Write("", args.Data);
                            }
                        });

                        processInvoker.ErrorDataReceived += new EventHandler<ProcessDataReceivedEventArgs>((sender, args) =>
                        {
                            if (!string.IsNullOrEmpty(args.Data))
                            {
                                executionContext.Write("", args.Data);
                            }
                        });

                        int exitCode = await processInvoker.ExecuteAsync(stagingDirectory, tar, $"-xzf \"{archiveFile}\"{tarextraopts}", null, CancellationToken.None);
                        if (exitCode != 0)
                        {
                            throw new NotSupportedException($"Can't use 'tar -xzf' extract archive file: {archiveFile}. return code: {exitCode}.");
                        }
                    }
                } else {
                    File.Move(archiveFile, Path.Combine(destDirectory, archiveName));
                    return;
                }

                if(unwrap) {
                    var subDirectories = new DirectoryInfo(stagingDirectory).GetDirectories();
                    if (subDirectories.Length != 1)
                    {
                        throw new InvalidOperationException($"'{archiveFile}' contains '{subDirectories.Length}' directories");
                    }
                    else
                    {
                        executionContext.Debug($"Unwrap '{subDirectories[0].Name}' to '{destDirectory}'");
                        IOUtil.MoveDirectory(subDirectories[0].FullName, destDirectory, stagingDirectory2, executionContext.CancellationToken);
                    }
                } else {
                    IOUtil.MoveDirectory(stagingDirectory, destDirectory, stagingDirectory2, executionContext.CancellationToken); 
                }
            } finally {
                IOUtil.DeleteDirectory(tempDirectory, CancellationToken.None);
            }
        }

        public static async Task<string> GetNodeTool(IHostContext hostContext, IExecutionContext executionContext, string name, string os, string arch) {
            string platform = os + "/" + arch;
            var externalsPath = hostContext.GetDirectory(WellKnownDirectory.Externals);
#if !OS_LINUX && !OS_WINDOWS && !OS_OSX && !X64 && !X86 && !ARM && !ARM64
            externalsPath = Path.Combine(externalsPath, os, arch);
#else
            if(GetHostOS() != os || GetHostArch() != arch) {
                externalsPath = Path.Combine(externalsPath, os, arch);
            }
#endif
            var exeExtension = os == "windows" ? ".exe" : "";
            string file = Path.Combine(externalsPath, name, "bin", $"node{exeExtension}");
            if(!File.Exists(file)) {
                executionContext.Write("", $"{file} executable not found locally");
                Dictionary<string, Func<string, Task>> _tools = null;
                if(name == "node12") {
                    string nodeUrl = "https://nodejs.org/dist";
                    string nodeUnofficialUrl = "https://unofficial-builds.nodejs.org/download/release";
                    string nodeVersion = "12.13.1";
                    string tarextraopts = System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.Windows) ? " --exclude \"*/lib/*\" \"*/bin/node*\" \"*/LICENSE\"" : "";
                    _tools = new Dictionary<string, Func<string, Task>> {
                        { "windows/386", dest => DownloadTool(hostContext, executionContext, NodeOfficialUrl(nodeUrl, nodeVersion, "win", "x86", "zip"), Path.Combine(dest, "bin"), unwrap: true)},
                        { "windows/amd64", dest => DownloadTool(hostContext, executionContext, NodeOfficialUrl(nodeUrl, nodeVersion, "win", "x64", "zip"), Path.Combine(dest, "bin"), unwrap: true)},
                        { "windows/arm64", dest => DownloadTool(hostContext, executionContext, NodeOfficialUrl(nodeUnofficialUrl, nodeVersion, "win", "arm64", "zip"), Path.Combine(dest, "bin"), unwrap: true)},
                        { "linux/386", dest => DownloadTool(hostContext, executionContext, NodeOfficialUrl(nodeUnofficialUrl, nodeVersion, "linux", "x86", "tar.gz"), dest, tarextraopts, true)},
                        { "linux/amd64", dest => DownloadTool(hostContext, executionContext, NodeOfficialUrl(nodeUrl, nodeVersion, "linux", "x64", "tar.gz"), dest, tarextraopts, true)},
                        { "linux/arm", dest => DownloadTool(hostContext, executionContext, NodeOfficialUrl(nodeUrl, nodeVersion, "linux", "armv7l", "tar.gz"), dest, tarextraopts, true)},
                        { "linux/arm64", dest => DownloadTool(hostContext, executionContext, NodeOfficialUrl(nodeUrl, nodeVersion, "linux", "arm64", "tar.gz"), dest, tarextraopts, true)},
                        { "osx/amd64", dest => DownloadTool(hostContext, executionContext, NodeOfficialUrl(nodeUrl, nodeVersion, "darwin", "x64", "tar.gz"), dest, tarextraopts, true)},
                    };

                } else if(name == "node12_alpine") {
                    string nodeVersion = "12.13.1";
                    _tools = new Dictionary<string, Func<string, Task>> {
                        { "linux/amd64", dest => DownloadTool(hostContext, executionContext, $"https://vstsagenttools.blob.core.windows.net/tools/nodejs/{nodeVersion}/alpine/x64/node-{nodeVersion}-alpine-x64.tar.gz", dest)},
                    };
                }
                if(_tools.TryGetValue(platform, out Func<string, Task> download)) {
                    executionContext.Write("", "downloading...");
                    await download(Path.Combine(externalsPath, name));
                    if(!File.Exists(file)) {
                        throw new Exception("node executable, not found after download");
                    }
                    executionContext.Write("", "node executable downloaded, continue workflow");
                } else {
                    throw new Exception("Failed to get node executable");
                }
            }
            return file;
        }
    }
}