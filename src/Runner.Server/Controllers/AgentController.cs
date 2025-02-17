﻿using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Threading.Tasks;
using GitHub.DistributedTask.WebApi;
using GitHub.Services.Location;
using GitHub.Services.WebApi;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using Runner.Server.Models;

namespace Runner.Server.Controllers
{
    [ApiController]
    [Route("{owner}/{repo}/_apis/v1/[controller]")]
    [Authorize(AuthenticationSchemes = "Bearer")]
    public class AgentController : VssControllerBase
    {
        private IMemoryCache _cache;

        private SqLiteDb _context;

        private static Object lck = new Object();

        public AgentController(IMemoryCache cache, SqLiteDb context)
        {
            _cache = cache;
            _context = context;
        }

        [HttpPost("{poolId}")]
        public async Task<IActionResult> Post(int poolId) {
            TaskAgent agent = await FromBody<TaskAgent>();
            agent.Authorization.AuthorizationUrl = new Uri($"{Request.Scheme}://{Request.Host.Host ?? (HttpContext.Connection.LocalIpAddress.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6 ? ("[" + HttpContext.Connection.LocalIpAddress.ToString() + "]") : HttpContext.Connection.LocalIpAddress.ToString())}:{Request.Host.Port ?? HttpContext.Connection.LocalPort}/test/auth/v1/");
            agent.Authorization.ClientId = Guid.NewGuid();
            lock(lck) {
                Agent _agent = Agent.CreateAgent(_cache, _context, poolId, agent);
                _context.SaveChanges();
            }
            return await Ok(agent);
        }

        [HttpGet("{poolId}/{agentId}")]
        public async Task<ActionResult> Get(int poolId, int agentId)
        {
            return await Ok(Agent.GetAgent(_cache, _context, poolId, agentId).TaskAgent);
        }

        [HttpDelete("{poolId}/{agentId}")]
        public void Delete(int poolId, int agentId)
        {
            lock(lck) {
                var agent = Agent.GetAgent(_cache, _context, poolId, agentId);
                _context.Agents.Remove(agent);
                _cache.Remove($"{Agent.CachePrefix}{poolId}_{agentId}");
            }
        }

        [HttpGet("{poolId}")]
        public async Task<ActionResult> Get(int poolId, [FromQuery] string agentName)
        {
            return await Ok(new VssJsonCollectionWrapper<List<TaskAgent>> (
                (from agent in Pool.GetPoolById(_cache, _context, poolId)?.Agents ?? new List<Agent>() where agent != null && agent.TaskAgent.Name == agentName select agent.TaskAgent).ToList()
            ));
        }
    }
}
