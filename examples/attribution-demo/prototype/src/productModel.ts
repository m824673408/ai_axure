import YAML from 'yaml';
import productSource from '../../product/product.yaml?raw';
import navigationSource from '../../product/navigation.yaml?raw';
import routesSource from '../../product/routes.yaml?raw';

export interface NavigationItem {
  module?: string;
  page?: string;
  name: string;
  children?: NavigationItem[];
}

export interface RouteDefinition {
  path: string;
  module: string;
}

interface ProductFile {
  product: { id: string; name: string; version: string };
  modules: Array<{ id: string; name: string }>;
}

export const productModel = YAML.parse(productSource) as ProductFile;
export const navigationModel = (YAML.parse(navigationSource) as { navigation: NavigationItem[] }).navigation;
export const routeModel = (YAML.parse(routesSource) as { routes: Record<string, RouteDefinition> }).routes;
