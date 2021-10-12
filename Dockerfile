FROM mcr.microsoft.com/dotnet/aspnet:5.0 AS runtime
FROM mcr.microsoft.com/dotnet/sdk:5.0 AS build

ADD . .

RUN cd src/ && dotnet msbuild ./dir.proj -t:GenerateConstant && cd Runner.Client && dotnet build --disable-parallel

CMD ["bin/bash"]
# RUN ./bin/Runner.Client --workflow workflow.yml --event push --payload payload.json --server http://localhost:5000