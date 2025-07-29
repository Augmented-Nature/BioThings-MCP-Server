#!/usr/bin/env node

/**
 * BioThings.io MCP Server
 * 
 * This MCP server provides access to BioThings.io APIs including:
 * - MyGene.info: Gene annotation service
 * - MyVariant.info: Variant annotation service
 * 
 * Features:
 * - Gene annotation retrieval by ID
 * - Gene querying with flexible search syntax
 * - Variant annotation retrieval by HGVS ID
 * - Variant querying with genomic ranges and filters
 * - Batch processing for multiple genes/variants
 * - Metadata and field information retrieval
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios from 'axios';

// API Base URLs
const MYGENE_BASE_URL = 'https://mygene.info/v3';
const MYVARIANT_BASE_URL = 'https://myvariant.info/v1';

// Type definitions
interface GeneAnnotationArgs {
  gene_id: string;
  fields?: string;
  species?: string;
}

interface GeneQueryArgs {
  q: string;
  species?: string;
  size?: number;
  from?: number;
  fields?: string;
  sort?: string;
  facets?: string;
}

interface VariantAnnotationArgs {
  variant_id: string;
  fields?: string;
}

interface VariantQueryArgs {
  q: string;
  size?: number;
  from?: number;
  fields?: string;
  sort?: string;
  facets?: string;
}

interface BatchGeneArgs {
  gene_ids: string[];
  fields?: string;
  species?: string;
}

interface BatchVariantArgs {
  variant_ids: string[];
  fields?: string;
}

// Validation functions
const isValidGeneAnnotationArgs = (args: any): args is GeneAnnotationArgs =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.gene_id === 'string' &&
  args.gene_id.trim().length > 0;

const isValidGeneQueryArgs = (args: any): args is GeneQueryArgs =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.q === 'string' &&
  args.q.trim().length > 0;

const isValidVariantAnnotationArgs = (args: any): args is VariantAnnotationArgs =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.variant_id === 'string' &&
  args.variant_id.trim().length > 0;

const isValidVariantQueryArgs = (args: any): args is VariantQueryArgs =>
  typeof args === 'object' &&
  args !== null &&
  typeof args.q === 'string' &&
  args.q.trim().length > 0;

const isValidBatchGeneArgs = (args: any): args is BatchGeneArgs =>
  typeof args === 'object' &&
  args !== null &&
  Array.isArray(args.gene_ids) &&
  args.gene_ids.length > 0 &&
  args.gene_ids.length <= 1000 &&
  args.gene_ids.every((id: any) => typeof id === 'string');

const isValidBatchVariantArgs = (args: any): args is BatchVariantArgs =>
  typeof args === 'object' &&
  args !== null &&
  Array.isArray(args.variant_ids) &&
  args.variant_ids.length > 0 &&
  args.variant_ids.length <= 1000 &&
  args.variant_ids.every((id: any) => typeof id === 'string');

class BioThingsServer {
  private server: Server;
  private axiosInstance;

  constructor() {
    this.server = new Server(
      {
        name: "biothings-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.axiosInstance = axios.create({
      timeout: 30000,
      headers: {
        'User-Agent': 'BioThings-MCP-Server/0.1.0'
      }
    });

    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_gene_annotation',
          description: 'Retrieve comprehensive gene annotation by Entrez or Ensembl gene ID',
          inputSchema: {
            type: 'object',
            properties: {
              gene_id: {
                type: 'string',
                description: 'Entrez gene ID (e.g., "1017") or Ensembl gene ID (e.g., "ENSG00000123374")'
              },
              fields: {
                type: 'string',
                description: 'Comma-separated fields to return (default: all available fields)',
                default: 'all'
              },
              species: {
                type: 'string',
                description: 'Species filter (human, mouse, rat, etc. or taxonomy ID)',
                default: 'all'
              }
            },
            required: ['gene_id']
          }
        },
        {
          name: 'query_genes',
          description: 'Search genes using flexible query syntax including symbols, names, genomic intervals, and more',
          inputSchema: {
            type: 'object',
            properties: {
              q: {
                type: 'string',
                description: 'Query string (e.g., "CDK2", "symbol:TP53", "chr1:1000-2000", "summary:insulin")'
              },
              species: {
                type: 'string',
                description: 'Species filter (human, mouse, rat, etc.)',
                default: 'all'
              },
              size: {
                type: 'number',
                description: 'Number of results to return (max 1000)',
                default: 10,
                maximum: 1000,
                minimum: 1
              },
              from: {
                type: 'number',
                description: 'Number of results to skip (for pagination)',
                default: 0,
                minimum: 0
              },
              fields: {
                type: 'string',
                description: 'Comma-separated fields to return',
                default: 'symbol,name,taxid,entrezgene'
              },
              sort: {
                type: 'string',
                description: 'Comma-separated fields to sort on (prefix with "-" for descending)'
              },
              facets: {
                type: 'string',
                description: 'Fields to return facets for (e.g., "taxid,type_of_gene")'
              }
            },
            required: ['q']
          }
        },
        {
          name: 'get_variant_annotation',
          description: 'Retrieve comprehensive variant annotation by HGVS ID',
          inputSchema: {
            type: 'object',
            properties: {
              variant_id: {
                type: 'string',
                description: 'HGVS variant ID (e.g., "chr7:g.55241707G>T", "chr1:g.35367G>A")'
              },
              fields: {
                type: 'string',
                description: 'Comma-separated fields to return (default: all available fields)',
                default: 'all'
              }
            },
            required: ['variant_id']
          }
        },
        {
          name: 'query_variants',
          description: 'Search variants using genomic ranges, rsIDs, gene names, and other criteria',
          inputSchema: {
            type: 'object',
            properties: {
              q: {
                type: 'string',
                description: 'Query string (e.g., "rs58991260", "chr1:69000-70000", "dbnsfp.genename:CDK2")'
              },
              size: {
                type: 'number',
                description: 'Number of results to return (max 1000)',
                default: 10,
                maximum: 1000,
                minimum: 1
              },
              from: {
                type: 'number',
                description: 'Number of results to skip (for pagination)',
                default: 0,
                minimum: 0
              },
              fields: {
                type: 'string',
                description: 'Comma-separated fields to return',
                default: 'all'
              },
              sort: {
                type: 'string',
                description: 'Comma-separated fields to sort on (prefix with "-" for descending)'
              },
              facets: {
                type: 'string',
                description: 'Fields to return facets for (e.g., "cadd.polyphen.cat")'
              }
            },
            required: ['q']
          }
        },
        {
          name: 'batch_gene_query',
          description: 'Retrieve annotations for multiple genes efficiently (up to 1000 genes)',
          inputSchema: {
            type: 'object',
            properties: {
              gene_ids: {
                type: 'array',
                items: {
                  type: 'string'
                },
                description: 'Array of gene IDs (Entrez or Ensembl)',
                maxItems: 1000,
                minItems: 1
              },
              fields: {
                type: 'string',
                description: 'Comma-separated fields to return',
                default: 'symbol,name,taxid,entrezgene'
              },
              species: {
                type: 'string',
                description: 'Species filter',
                default: 'all'
              }
            },
            required: ['gene_ids']
          }
        },
        {
          name: 'batch_variant_query',
          description: 'Retrieve annotations for multiple variants efficiently (up to 1000 variants)',
          inputSchema: {
            type: 'object',
            properties: {
              variant_ids: {
                type: 'array',
                items: {
                  type: 'string'
                },
                description: 'Array of HGVS variant IDs',
                maxItems: 1000,
                minItems: 1
              },
              fields: {
                type: 'string',
                description: 'Comma-separated fields to return',
                default: 'all'
              }
            },
            required: ['variant_ids']
          }
        },
        {
          name: 'get_gene_metadata',
          description: 'Get metadata about MyGene.info API including available fields and data sources',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
          }
        },
        {
          name: 'get_variant_metadata',
          description: 'Get metadata about MyVariant.info API including available fields and data sources',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
          }
        },
        {
          name: 'get_gene_fields',
          description: 'Get all available fields for gene annotation with descriptions',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
          }
        },
        {
          name: 'get_variant_fields',
          description: 'Get all available fields for variant annotation with descriptions',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
          }
        },
        {
          name: 'search_genes_by_pathway',
          description: 'Search genes by pathway (KEGG, Reactome, BioCarta, etc.)',
          inputSchema: {
            type: 'object',
            properties: {
              pathway_name: {
                type: 'string',
                description: 'Pathway name or ID (e.g., "cell cycle", "hsa04110", "p53 signaling")'
              },
              pathway_source: {
                type: 'string',
                description: 'Pathway database source',
                enum: ['kegg', 'reactome', 'biocarta', 'pid', 'wikipathways', 'netpath'],
                default: 'kegg'
              },
              species: {
                type: 'string',
                description: 'Species filter',
                default: 'human'
              },
              size: {
                type: 'number',
                description: 'Number of results to return',
                default: 50,
                maximum: 1000
              }
            },
            required: ['pathway_name']
          }
        },
        {
          name: 'search_genes_by_go_term',
          description: 'Search genes by Gene Ontology terms (biological process, molecular function, cellular component)',
          inputSchema: {
            type: 'object',
            properties: {
              go_term: {
                type: 'string',
                description: 'GO term name or ID (e.g., "apoptosis", "GO:0006915", "kinase activity")'
              },
              go_category: {
                type: 'string',
                description: 'GO category',
                enum: ['BP', 'MF', 'CC', 'all'],
                default: 'all'
              },
              species: {
                type: 'string',
                description: 'Species filter',
                default: 'human'
              },
              size: {
                type: 'number',
                description: 'Number of results to return',
                default: 50,
                maximum: 1000
              }
            },
            required: ['go_term']
          }
        },
        {
          name: 'search_variants_by_gene',
          description: 'Find all variants in or near a specific gene',
          inputSchema: {
            type: 'object',
            properties: {
              gene_symbol: {
                type: 'string',
                description: 'Gene symbol (e.g., "BRCA1", "TP53", "EGFR")'
              },
              variant_types: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['snp', 'indel', 'cnv', 'sv']
                },
                description: 'Types of variants to include',
                default: ['snp', 'indel']
              },
              clinical_significance: {
                type: 'string',
                description: 'ClinVar clinical significance filter',
                enum: ['pathogenic', 'likely_pathogenic', 'benign', 'likely_benign', 'uncertain_significance', 'all'],
                default: 'all'
              },
              size: {
                type: 'number',
                description: 'Number of results to return',
                default: 100,
                maximum: 1000
              }
            },
            required: ['gene_symbol']
          }
        },
        {
          name: 'search_pathogenic_variants',
          description: 'Search for pathogenic or likely pathogenic variants with clinical annotations',
          inputSchema: {
            type: 'object',
            properties: {
              gene_list: {
                type: 'array',
                items: {
                  type: 'string'
                },
                description: 'Optional list of genes to focus on (e.g., ["BRCA1", "BRCA2", "TP53"])'
              },
              disease_terms: {
                type: 'array',
                items: {
                  type: 'string'
                },
                description: 'Disease terms to search for (e.g., ["cancer", "cardiomyopathy"])'
              },
              cadd_threshold: {
                type: 'number',
                description: 'Minimum CADD score threshold (higher = more deleterious)',
                default: 20,
                minimum: 0,
                maximum: 50
              },
              size: {
                type: 'number',
                description: 'Number of results to return',
                default: 100,
                maximum: 1000
              }
            }
          }
        },
        {
          name: 'get_gene_orthologs',
          description: 'Find orthologous genes across species using HomoloGene',
          inputSchema: {
            type: 'object',
            properties: {
              gene_id: {
                type: 'string',
                description: 'Gene ID (Entrez or symbol) to find orthologs for'
              },
              target_species: {
                type: 'array',
                items: {
                  type: 'string'
                },
                description: 'Target species to find orthologs in (e.g., ["mouse", "rat", "zebrafish"])',
                default: ['mouse', 'rat']
              },
              fields: {
                type: 'string',
                description: 'Fields to return for ortholog genes',
                default: 'symbol,name,taxid,entrezgene,homologene'
              }
            },
            required: ['gene_id']
          }
        },
        {
          name: 'search_drug_target_genes',
          description: 'Search for genes that are drug targets using PharmGKB annotations',
          inputSchema: {
            type: 'object',
            properties: {
              drug_name: {
                type: 'string',
                description: 'Drug name to search for (e.g., "warfarin", "aspirin", "metformin")'
              },
              interaction_type: {
                type: 'string',
                description: 'Type of drug-gene interaction',
                enum: ['target', 'enzyme', 'transporter', 'carrier', 'all'],
                default: 'all'
              },
              species: {
                type: 'string',
                description: 'Species filter',
                default: 'human'
              },
              size: {
                type: 'number',
                description: 'Number of results to return',
                default: 50,
                maximum: 1000
              }
            },
            required: ['drug_name']
          }
        },
        {
          name: 'get_genomic_interval_genes',
          description: 'Get all genes within a specific genomic interval with detailed annotations',
          inputSchema: {
            type: 'object',
            properties: {
              chromosome: {
                type: 'string',
                description: 'Chromosome (e.g., "1", "chr1", "X")'
              },
              start: {
                type: 'number',
                description: 'Start position (1-based)',
                minimum: 1
              },
              end: {
                type: 'number',
                description: 'End position (1-based)',
                minimum: 1
              },
              species: {
                type: 'string',
                description: 'Species',
                default: 'human'
              },
              gene_types: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['protein-coding', 'lncRNA', 'miRNA', 'pseudogene', 'all']
                },
                description: 'Types of genes to include',
                default: ['protein-coding']
              },
              fields: {
                type: 'string',
                description: 'Fields to return',
                default: 'symbol,name,type_of_gene,genomic_pos,summary'
              }
            },
            required: ['chromosome', 'start', 'end']
          }
        },
        {
          name: 'search_variants_by_population_frequency',
          description: 'Search variants by population frequency thresholds (rare, common, etc.)',
          inputSchema: {
            type: 'object',
            properties: {
              frequency_source: {
                type: 'string',
                description: 'Population frequency database',
                enum: ['gnomad', 'exac', '1000genomes', 'esp'],
                default: 'gnomad'
              },
              frequency_threshold: {
                type: 'number',
                description: 'Frequency threshold (e.g., 0.01 for 1%, 0.001 for 0.1%)',
                minimum: 0,
                maximum: 1,
                default: 0.01
              },
              frequency_operator: {
                type: 'string',
                description: 'Frequency comparison operator',
                enum: ['>', '<', '>=', '<='],
                default: '<'
              },
              population: {
                type: 'string',
                description: 'Specific population (e.g., "afr", "eas", "nfe", "all")',
                default: 'all'
              },
              functional_impact: {
                type: 'string',
                description: 'Functional impact filter',
                enum: ['high', 'moderate', 'low', 'all'],
                default: 'all'
              },
              size: {
                type: 'number',
                description: 'Number of results to return',
                default: 100,
                maximum: 1000
              }
            }
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case 'get_gene_annotation':
            return await this.handleGeneAnnotation(request.params.arguments);
          
          case 'query_genes':
            return await this.handleGeneQuery(request.params.arguments);
          
          case 'get_variant_annotation':
            return await this.handleVariantAnnotation(request.params.arguments);
          
          case 'query_variants':
            return await this.handleVariantQuery(request.params.arguments);
          
          case 'batch_gene_query':
            return await this.handleBatchGeneQuery(request.params.arguments);
          
          case 'batch_variant_query':
            return await this.handleBatchVariantQuery(request.params.arguments);
          
          case 'get_gene_metadata':
            return await this.handleGeneMetadata();
          
          case 'get_variant_metadata':
            return await this.handleVariantMetadata();
          
          case 'get_gene_fields':
            return await this.handleGeneFields();
          
          case 'get_variant_fields':
            return await this.handleVariantFields();
          
          case 'search_genes_by_pathway':
            return await this.handleSearchGenesByPathway(request.params.arguments);
          
          case 'search_genes_by_go_term':
            return await this.handleSearchGenesByGoTerm(request.params.arguments);
          
          case 'search_variants_by_gene':
            return await this.handleSearchVariantsByGene(request.params.arguments);
          
          case 'search_pathogenic_variants':
            return await this.handleSearchPathogenicVariants(request.params.arguments);
          
          case 'get_gene_orthologs':
            return await this.handleGetGeneOrthologs(request.params.arguments);
          
          case 'search_drug_target_genes':
            return await this.handleSearchDrugTargetGenes(request.params.arguments);
          
          case 'get_genomic_interval_genes':
            return await this.handleGetGenomicIntervalGenes(request.params.arguments);
          
          case 'search_variants_by_population_frequency':
            return await this.handleSearchVariantsByPopulationFrequency(request.params.arguments);
          
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          const message = error.response?.data?.error || error.message;
          
          if (status === 404) {
            return {
              content: [{
                type: 'text',
                text: `Not found: ${message}`
              }],
              isError: true
            };
          }
          
          throw new McpError(
            ErrorCode.InternalError,
            `API error (${status}): ${message}`
          );
        }
        
        throw new McpError(
          ErrorCode.InternalError,
          `Unexpected error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  private async handleGeneAnnotation(args: any) {
    if (!isValidGeneAnnotationArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid gene annotation arguments. gene_id is required.'
      );
    }

    const params: any = {};
    if (args.fields && args.fields !== 'all') {
      params.fields = args.fields;
    }
    if (args.species && args.species !== 'all') {
      params.species = args.species;
    }

    const response = await this.axiosInstance.get(
      `${MYGENE_BASE_URL}/gene/${encodeURIComponent(args.gene_id)}`,
      { params }
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  private async handleGeneQuery(args: any) {
    if (!isValidGeneQueryArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid gene query arguments. q is required.'
      );
    }

    const params: any = { q: args.q };
    if (args.species) params.species = args.species;
    if (args.size) params.size = args.size;
    if (args.from) params.from = args.from;
    if (args.fields) params.fields = args.fields;
    if (args.sort) params.sort = args.sort;
    if (args.facets) params.facets = args.facets;

    const response = await this.axiosInstance.get(
      `${MYGENE_BASE_URL}/query`,
      { params }
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  private async handleVariantAnnotation(args: any) {
    if (!isValidVariantAnnotationArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid variant annotation arguments. variant_id is required.'
      );
    }

    const params: any = {};
    if (args.fields && args.fields !== 'all') {
      params.fields = args.fields;
    }

    const response = await this.axiosInstance.get(
      `${MYVARIANT_BASE_URL}/variant/${encodeURIComponent(args.variant_id)}`,
      { params }
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  private async handleVariantQuery(args: any) {
    if (!isValidVariantQueryArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid variant query arguments. q is required.'
      );
    }

    const params: any = { q: args.q };
    if (args.size) params.size = args.size;
    if (args.from) params.from = args.from;
    if (args.fields) params.fields = args.fields;
    if (args.sort) params.sort = args.sort;
    if (args.facets) params.facets = args.facets;

    const response = await this.axiosInstance.get(
      `${MYVARIANT_BASE_URL}/query`,
      { params }
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  private async handleBatchGeneQuery(args: any) {
    if (!isValidBatchGeneArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid batch gene arguments. gene_ids array is required (max 1000 items).'
      );
    }

    const data = new URLSearchParams();
    data.append('ids', args.gene_ids.join(','));
    if (args.fields) data.append('fields', args.fields);
    if (args.species) data.append('species', args.species);

    const response = await this.axiosInstance.post(
      `${MYGENE_BASE_URL}/gene`,
      data,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  private async handleBatchVariantQuery(args: any) {
    if (!isValidBatchVariantArgs(args)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid batch variant arguments. variant_ids array is required (max 1000 items).'
      );
    }

    const data = new URLSearchParams();
    data.append('ids', args.variant_ids.join(','));
    if (args.fields) data.append('fields', args.fields);

    const response = await this.axiosInstance.post(
      `${MYVARIANT_BASE_URL}/variant`,
      data,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  private async handleGeneMetadata() {
    const response = await this.axiosInstance.get(`${MYGENE_BASE_URL}/metadata`);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  private async handleVariantMetadata() {
    const response = await this.axiosInstance.get(`${MYVARIANT_BASE_URL}/metadata`);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  private async handleGeneFields() {
    const response = await this.axiosInstance.get(`${MYGENE_BASE_URL}/metadata/fields`);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  private async handleVariantFields() {
    const response = await this.axiosInstance.get(`${MYVARIANT_BASE_URL}/metadata/fields`);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  private async handleSearchGenesByPathway(args: any) {
    if (!args || typeof args.pathway_name !== 'string') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'pathway_name is required'
      );
    }

    const pathwaySource = args.pathway_source || 'kegg';
    const species = args.species || 'human';
    const size = args.size || 50;

    let query = '';
    if (pathwaySource === 'kegg') {
      query = `pathway.kegg.name:"${args.pathway_name}" OR pathway.kegg.id:"${args.pathway_name}"`;
    } else if (pathwaySource === 'reactome') {
      query = `pathway.reactome.name:"${args.pathway_name}" OR pathway.reactome.id:"${args.pathway_name}"`;
    } else {
      query = `pathway.${pathwaySource}:"${args.pathway_name}"`;
    }

    const params = {
      q: query,
      species: species,
      size: size,
      fields: 'symbol,name,pathway,summary'
    };

    const response = await this.axiosInstance.get(`${MYGENE_BASE_URL}/query`, { params });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  private async handleSearchGenesByGoTerm(args: any) {
    if (!args || typeof args.go_term !== 'string') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'go_term is required'
      );
    }

    const goCategory = args.go_category || 'all';
    const species = args.species || 'human';
    const size = args.size || 50;

    let query = '';
    if (goCategory === 'all') {
      query = `go.BP.term:"${args.go_term}" OR go.MF.term:"${args.go_term}" OR go.CC.term:"${args.go_term}" OR go.BP.id:"${args.go_term}" OR go.MF.id:"${args.go_term}" OR go.CC.id:"${args.go_term}"`;
    } else {
      query = `go.${goCategory}.term:"${args.go_term}" OR go.${goCategory}.id:"${args.go_term}"`;
    }

    const params = {
      q: query,
      species: species,
      size: size,
      fields: 'symbol,name,go,summary'
    };

    const response = await this.axiosInstance.get(`${MYGENE_BASE_URL}/query`, { params });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  private async handleSearchVariantsByGene(args: any) {
    if (!args || typeof args.gene_symbol !== 'string') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'gene_symbol is required'
      );
    }

    const size = args.size || 100;
    const variantTypes = args.variant_types || ['snp', 'indel'];
    const clinicalSignificance = args.clinical_significance || 'all';

    let query = `dbnsfp.genename:"${args.gene_symbol}"`;

    // Add variant type filter
    if (variantTypes.length > 0 && !variantTypes.includes('all')) {
      const typeQuery = variantTypes.map((type: string) => `dbsnp.vartype:${type}`).join(' OR ');
      query += ` AND (${typeQuery})`;
    }

    // Add clinical significance filter
    if (clinicalSignificance !== 'all') {
      query += ` AND clinvar.clinical_significance:"${clinicalSignificance}"`;
    }

    const params = {
      q: query,
      size: size,
      fields: 'dbnsfp.genename,clinvar.clinical_significance,cadd.phred,dbsnp.vartype'
    };

    const response = await this.axiosInstance.get(`${MYVARIANT_BASE_URL}/query`, { params });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  private async handleSearchPathogenicVariants(args: any) {
    const size = args?.size || 100;
    const caddThreshold = args?.cadd_threshold || 20;

    let query = 'clinvar.clinical_significance:("pathogenic" OR "likely pathogenic")';

    // Add CADD score filter
    query += ` AND cadd.phred:>=${caddThreshold}`;

    // Add gene filter if provided
    if (args?.gene_list && Array.isArray(args.gene_list) && args.gene_list.length > 0) {
      const geneQuery = args.gene_list.map((gene: string) => `dbnsfp.genename:"${gene}"`).join(' OR ');
      query += ` AND (${geneQuery})`;
    }

    // Add disease terms if provided
    if (args?.disease_terms && Array.isArray(args.disease_terms) && args.disease_terms.length > 0) {
      const diseaseQuery = args.disease_terms.map((term: string) => `clinvar.conditions.name:"${term}"`).join(' OR ');
      query += ` AND (${diseaseQuery})`;
    }

    const params = {
      q: query,
      size: size,
      fields: 'dbnsfp.genename,clinvar.clinical_significance,clinvar.conditions,cadd.phred,dbsnp.rsid'
    };

    const response = await this.axiosInstance.get(`${MYVARIANT_BASE_URL}/query`, { params });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  private async handleGetGeneOrthologs(args: any) {
    if (!args || typeof args.gene_id !== 'string') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'gene_id is required'
      );
    }

    const targetSpecies = args.target_species || ['mouse', 'rat'];
    const fields = args.fields || 'symbol,name,taxid,entrezgene,homologene';

    // First get the gene to find its homologene ID
    const geneResponse = await this.axiosInstance.get(
      `${MYGENE_BASE_URL}/gene/${encodeURIComponent(args.gene_id)}`,
      { params: { fields: 'homologene' } }
    );

    if (!geneResponse.data.homologene) {
      return {
        content: [{
          type: 'text',
          text: 'No ortholog information available for this gene'
        }]
      };
    }

    const homologeneId = geneResponse.data.homologene.id;

    // Search for orthologs using homologene ID
    const speciesQuery = targetSpecies.map((species: string) => `taxid:"${species}"`).join(' OR ');
    const query = `homologene.id:${homologeneId} AND (${speciesQuery})`;

    const params = {
      q: query,
      size: 100,
      fields: fields
    };

    const response = await this.axiosInstance.get(`${MYGENE_BASE_URL}/query`, { params });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  private async handleSearchDrugTargetGenes(args: any) {
    if (!args || typeof args.drug_name !== 'string') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'drug_name is required'
      );
    }

    const interactionType = args.interaction_type || 'all';
    const species = args.species || 'human';
    const size = args.size || 50;

    let query = `pharmgkb:"${args.drug_name}"`;

    const params = {
      q: query,
      species: species,
      size: size,
      fields: 'symbol,name,pharmgkb,summary'
    };

    const response = await this.axiosInstance.get(`${MYGENE_BASE_URL}/query`, { params });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  private async handleGetGenomicIntervalGenes(args: any) {
    if (!args || typeof args.chromosome !== 'string' || typeof args.start !== 'number' || typeof args.end !== 'number') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'chromosome, start, and end are required'
      );
    }

    const species = args.species || 'human';
    const geneTypes = args.gene_types || ['protein-coding'];
    const fields = args.fields || 'symbol,name,type_of_gene,genomic_pos,summary';

    // Format chromosome
    const chr = args.chromosome.replace(/^chr/, '');
    const query = `${chr}:${args.start}-${args.end}`;

    let params: any = {
      q: query,
      species: species,
      size: 1000,
      fields: fields
    };

    // Add gene type filter if not 'all'
    if (!geneTypes.includes('all')) {
      const typeQuery = geneTypes.map((type: string) => `type_of_gene:"${type}"`).join(' OR ');
      params.q += ` AND (${typeQuery})`;
    }

    const response = await this.axiosInstance.get(`${MYGENE_BASE_URL}/query`, { params });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  private async handleSearchVariantsByPopulationFrequency(args: any) {
    const frequencySource = args?.frequency_source || 'gnomad';
    const frequencyThreshold = args?.frequency_threshold || 0.01;
    const frequencyOperator = args?.frequency_operator || '<';
    const population = args?.population || 'all';
    const functionalImpact = args?.functional_impact || 'all';
    const size = args?.size || 100;

    let query = '';

    // Build frequency query
    if (population === 'all') {
      query = `${frequencySource}.af:${frequencyOperator}${frequencyThreshold}`;
    } else {
      query = `${frequencySource}.af.${population}:${frequencyOperator}${frequencyThreshold}`;
    }

    // Add functional impact filter
    if (functionalImpact !== 'all') {
      if (functionalImpact === 'high') {
        query += ' AND dbnsfp.sift.pred:"D" AND dbnsfp.polyphen2.hdiv.pred:"D"';
      } else if (functionalImpact === 'moderate') {
        query += ' AND (dbnsfp.sift.pred:"T" OR dbnsfp.polyphen2.hdiv.pred:"P")';
      } else if (functionalImpact === 'low') {
        query += ' AND dbnsfp.sift.pred:"T" AND dbnsfp.polyphen2.hdiv.pred:"B"';
      }
    }

    const params = {
      q: query,
      size: size,
      fields: `${frequencySource}.af,dbnsfp.genename,dbnsfp.sift.pred,dbnsfp.polyphen2.hdiv.pred,cadd.phred`
    };

    const response = await this.axiosInstance.get(`${MYVARIANT_BASE_URL}/query`, { params });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response.data, null, 2)
      }]
    };
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('BioThings MCP server running on stdio');
  }
}

const server = new BioThingsServer();
server.run().catch(console.error);
