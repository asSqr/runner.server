FROM mcr.microsoft.com/dotnet/aspnet:5.0 AS runtime
FROM mcr.microsoft.com/dotnet/sdk:5.0 AS build

RUN mkdir app
ADD . ./app

WORKDIR app/src

ENV ASPNETCORE_URLS=http://+:5000
EXPOSE 5000

# RUN cd src/ && dotnet msbuild ./dir.proj -t:GenerateConstant && cd Runner.Client && dotnet build --disable-parallel
RUN ./dev.sh build

CMD ["/bin/bash"]
# RUN ./bin/Runner.Client --workflow workflow.yml --event push --payload payload.json --server http://localhost:5000