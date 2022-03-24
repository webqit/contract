
/**
 * @imports
 */
import Base from './Base.js';

/**
 * @Console2
 */
export default class Inspector extends Base( HTMLElement ) {

    connectedCallback() {
        this._contentSlot = document.createElement( 'slot' );
        // ----------------
        this.shadowRoot.append( this._contentSlot );
        // ----------------
        super.connectedCallback();
        this._contentSlot.addEventListener( 'slotchange', () => {
            setTimeout( () => { // Allow embedded subscripts in slotted elements to manifest
                let subscriptElement = this._contentSlot.assignedNodes().reduce( ( _subscriptElement, node ) => _subscriptElement || ( node.subscripts instanceof Map ? node : null), null );
                if ( subscriptElement ) {
                    this.inspectElement( subscriptElement );
                }
            }, 0 );
        } );
    }

    inspectElement( subscriptElement ) {
        if ( this.consoleElement ) {
            this.consoleElement.remove();
            this.controlsElement.remove();
        }
        this.consoleElement = document.createElement( 'subscript-console' );
        this.controlsElement = document.createElement( 'div' );
        this.controlsElement.classList.add( 'controls-element' );
        // ----------------
        this.shadowRoot.append( this.consoleElement, this.controlsElement );
        // ----------------
        this.buttons = {};
        subscriptElement.subscripts.forEach( ( subscriptFunction, id ) => {
            let title = typeof id === 'number' ? `script:${ id }` : `${ id }()`;
            this.buttons[ id ] = this.controlsElement.appendChild( document.createElement( 'button' ) );
            this.buttons[ id ].setAttribute( 'script-id', id );
            this.buttons[ id ].setAttribute( 'title',  title );
            let textElement = this.buttons[ id ].appendChild( document.createElement( 'span' ) );
            textElement.append( ' ',  title );
            let iconElement = this.buttons[ id ].appendChild( document.createElement( 'i' ) );
            let iconClasses = this.getAttribute( `data-icons` ) || `bi bi-${ typeof id === 'number' ? 'code' : 'braces' }`;
            iconClasses.split( ' ' ).map( str => str.trim() ).forEach( str => iconElement.classList.add( str ) );
            this.buttons[ id ].addEventListener( 'click', e => {
                if ( this.active ) {
                    this.active.classList.remove( 'active' );
                }
                this.active = this.buttons[ id ];
                this.active.classList.add( 'active' );
                this.inspectFunction( subscriptFunction );
            } );
        } );
    }

    inspectFunction( subscriptFunction ) {
        if ( !subscriptFunction ) {
            let buttins = Object.keys( this.buttons );
            if ( buttins.length ) {
                let firstButton = this.buttons[ buttins[ 0 ] ];
                let event = new MouseEvent( 'click', {
                    view: window,
                    bubbles: true,
                    cancelable: true
                } );
                firstButton.dispatchEvent( event );
            }
            return;
        };
        this.consoleElement.bind( subscriptFunction );
    }

    /**
     * ----------
     *  CSS
     * ----------
     */

     get css() {
        return [
            `https://cdn.jsdelivr.net/npm/bootstrap-icons@1.5.0/font/bootstrap-icons.css`,
            `
            * {
                -webkit-box-sizing: border-box;
                -moz-box-sizing: border-box;
                box-sizing: border-box;
            }
            :host {
                position: relative;
                display: block;
                background-color: rgb(75, 75, 75);
            }
            .controls-element {
                position: relative;
                z-index: 10;
            }
            .controls-element button {
                display: inline-flex;
                align-items: center;
                background-color: transparent;
                padding: 0.5rem 1rem;
                border: none;
                color: silver;
            }
            .controls-element button:is(:hover, .active) {
                background-color: dimgray;
                color: gainsboro;
            }
            .controls-element button .bi {
                margin-left: 0.5rem;
            }
            `,
        ]
    }

}

/**
 * @define
 */
customElements.define( 'subscript-inspector', Inspector );
