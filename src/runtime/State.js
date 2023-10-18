
/**
 * @imports
 */
import Observer from "@webqit/observer";

export default class State {

    constructor( runtime ) {
        Object.defineProperty( this, 'runtime', { value: runtime } );
        const events = { statechange: () => { Observer.defineProperty( this, 'value', { value: runtime.flowControl.get( 'return' )?.arg, enumerable: true, configurable: true } ); }, };
        for ( const name in events ) {
            runtime.on( name, events[ name ] );
            events[ name ]();
        }
        if ( runtime.$params.sourceType === 'module' ) { Object.defineProperty( this, 'exports', { value: runtime.exports } ); }
    }
    
    dispose() { return this.runtime.abort(); }

}
